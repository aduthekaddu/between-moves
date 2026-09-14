import { submitMoveBodySchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  MoveConflictError,
  type AuthenticatedViewer,
  type ChessMoveProposal,
  type SubmitMoveRequest,
  type SubmitMoveResult,
} from '@between-moves/domain';
import type { MoveMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { MoveRateLimit } from '../kernel/move-rate-limit';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 4_096;
const identifierSchema = z.string().uuid();
const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface SubmitMoveHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitMove: MoveRateLimit;
  readonly submitMove: (request: SubmitMoveRequest) => Promise<SubmitMoveResult>;
  readonly logger: StructuredLogger;
  readonly metrics: MoveMetricStubs;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'Move details are invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function requestId(request: Request): string {
  const parsed = requestIdSchema.safeParse(request.headers.get('x-request-id'));
  return parsed.success ? parsed.data : crypto.randomUUID();
}

function commandError(request: Request, error: unknown, metrics: MoveMetricStubs): Response | null {
  if (error instanceof MoveConflictError) {
    metrics.incrementMoveConflict();
    return problem(
      request,
      409,
      'move_conflict',
      'Move conflict',
      'The Game position changed. Refresh from the current position.',
      {
        meta: {
          version: error.current.version,
          currentPly: error.current.currentPly,
          fen: error.current.fen,
        },
      },
    );
  }
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only the seated Member on turn can submit a Move.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'validation_failed') return validationProblem(request, error.message);
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'The Game is unavailable.');
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'game_conflict', 'Game conflict', error.message);
  }
  return null;
}

function responseClock(result: SubmitMoveResult): Readonly<Record<string, unknown>> {
  return result.clock.kind === 'correspondence'
    ? {
        ...(result.clock.moveDueAt === null
          ? {}
          : { moveDueAt: result.clock.moveDueAt.toISOString() }),
      }
    : {
        whiteMs: result.clock.whiteMs,
        blackMs: result.clock.blackMs,
        turnStartedAt: result.clock.turnStartedAt.toISOString(),
      };
}

/** [BM-024] House-scoped POST boundary for the sole durable Move command. */
export function createSubmitMoveHandler(dependencies: SubmitMoveHandlerDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
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
    if (
      !identifierSchema.safeParse(houseId).success ||
      !identifierSchema.safeParse(gameId).success
    ) {
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
        'Sign in to submit a Move.',
      );
    }
    const rateLimit = await dependencies.limitMove(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many Moves',
        'Try submitting the Move again shortly.',
        {
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }
    const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
    if (body.kind === 'too_large') {
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Move details are too large.',
      );
    }
    if (body.kind === 'invalid') return validationProblem(request);
    const parsedBody = submitMoveBodySchema.safeParse(body.value);
    if (!parsedBody.success) return validationProblem(request);
    const command = {
      houseId,
      gameId,
      expectedPly: parsedBody.data.expectedPly,
      clientCommandId: parsedBody.data.clientCommandId,
      move: parsedBody.data.move as ChessMoveProposal,
      viewer,
    };
    try {
      const result = await dependencies.submitMove(command);
      const durationMs = Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime());
      dependencies.metrics.observeMoveAcceptLatency(durationMs);
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: requestId(request),
          actorId: viewer.userId,
          houseId: result.houseId,
          gameId: result.gameId,
          commandId: command.clientCommandId,
          event: 'game.move-accepted',
          outcome: 'success',
          durationMs,
          data: { ply: result.ply, replayed: result.replayed },
        });
      } catch {
        // A committed Move remains successful when diagnostics are unavailable.
      }
      if (result.completedNow) {
        try {
          dependencies.logger.log({
            level: 'info',
            requestId: requestId(request),
            actorId: viewer.userId,
            houseId: result.houseId,
            gameId: result.gameId,
            commandId: command.clientCommandId,
            event: 'game.completed',
            outcome: 'success',
            durationMs,
            data: { source: 'move' },
          });
        } catch {
          // A committed completion remains successful when diagnostics are unavailable.
        }
      }
      return Response.json(
        {
          ply: result.ply,
          uci: result.uci,
          san: result.san,
          fenAfter: result.fenAfter,
          sideToMove: result.sideToMove,
          version: result.version,
          clock: responseClock(result),
        },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error, dependencies.metrics);
      if (response !== null) {
        try {
          dependencies.logger.log({
            level: 'info',
            requestId: requestId(request),
            actorId: viewer.userId,
            houseId,
            gameId,
            commandId: command.clientCommandId,
            event: 'game.move-rejected',
            outcome: 'rejected',
            durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
            data: { code: error instanceof DomainError ? error.code : 'forbidden' },
          });
        } catch {
          // A rejection response does not depend on diagnostics.
        }
        return response;
      }
      throw error;
    }
  };
}
