import { createGameSeatBodySchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type CreateGameSeatRequest,
  type GameSeatCreationResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 4_096;
const identifierSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(128);
const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface GameSeatCommandHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly createGameSeat: (request: CreateGameSeatRequest) => Promise<GameSeatCreationResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'Game seat details are invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function commandError(request: Request, error: unknown): Response | null {
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(request, 403, 'forbidden', 'Forbidden', 'Only House Members can open a seat.');
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'validation_failed') return validationProblem(request, error.message);
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'Game seat details are unavailable.');
  }
  if (error.code === 'idempotency_conflict') {
    return problem(
      request,
      409,
      'idempotency_conflict',
      'Idempotency conflict',
      'The Idempotency-Key was already used for another Game seat command.',
    );
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'game_conflict', 'Game conflict', error.message);
  }
  return null;
}

function requestId(request: Request): string {
  const parsed = requestIdSchema.safeParse(request.headers.get('x-request-id'));
  return parsed.success ? parsed.data : crypto.randomUUID();
}

function logCreated(
  dependencies: GameSeatCommandHandlerDependencies,
  request: Request,
  viewer: AuthenticatedViewer,
  result: GameSeatCreationResult,
  idempotencyKey: string | null,
  startedAt: Date,
): void {
  if (!result.createdNow) return;
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: requestId(request),
      actorId: viewer.userId,
      houseId: result.houseId,
      gameId: result.gameId,
      commandId: idempotencyKey,
      event: 'seat.created',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: {
        open_seat_id: result.openSeatId,
        offered_color: result.offeredColor,
        direct: result.intendedMembershipId !== null,
      },
    });
  } catch {
    // A committed Game seat remains created when diagnostics are unavailable.
  }
}

/** [BM-022] POST boundary for Open seats and direct challenges. */
export function createGameSeatCommandHandler(dependencies: GameSeatCommandHandlerDependencies) {
  return async (request: Request, houseId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    if (!identifierSchema.safeParse(houseId).success) {
      return validationProblem(request, 'Game route is invalid.');
    }
    let viewer: AuthenticatedViewer;
    try {
      viewer = await dependencies.requireViewer(request);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      return problem(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to open a seat.',
      );
    }
    const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
    if (body.kind === 'too_large') {
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Game seat details are too large.',
      );
    }
    if (body.kind === 'invalid') return validationProblem(request);
    const parsedBody = createGameSeatBodySchema.safeParse(body.value);
    if (!parsedBody.success) return validationProblem(request);
    const rawKey = request.headers.get('idempotency-key');
    const parsedKey = rawKey === null ? null : idempotencyKeySchema.safeParse(rawKey);
    if (parsedKey !== null && !parsedKey.success) {
      return validationProblem(request, 'Idempotency-Key must contain 1 to 128 characters.');
    }
    const idempotencyKey = parsedKey === null ? null : parsedKey.data;
    try {
      const result = await dependencies.createGameSeat({
        houseId,
        mode: parsedBody.data.mode,
        clockPolicy: parsedBody.data.clockPolicy,
        offeredColor: parsedBody.data.offeredColor,
        intendedMembershipId: parsedBody.data.intendedMembershipId ?? null,
        idempotencyKey,
        viewer,
      });
      logCreated(dependencies, request, viewer, result, idempotencyKey, startedAt);
      return Response.json(
        { gameId: result.gameId, openSeatId: result.openSeatId },
        { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
