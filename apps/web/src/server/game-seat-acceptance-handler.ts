import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AcceptGameSeatRequest,
  type AuthenticatedViewer,
  type GameSeatAcceptanceResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readRequestId } from '../kernel/request';

const identifierSchema = z.string().uuid();

export interface GameSeatAcceptanceHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly acceptGameSeat: (request: AcceptGameSeatRequest) => Promise<GameSeatAcceptanceResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function commandError(request: Request, error: unknown): Response | null {
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'This Member cannot accept the Open seat.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'conflict') {
    return problem(request, 409, 'seat_taken', 'Seat taken', 'The Open seat is no longer open.');
  }
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'The Open seat is unavailable.');
  }
  return null;
}

function logActivation(
  dependencies: GameSeatAcceptanceHandlerDependencies,
  request: Request,
  viewer: AuthenticatedViewer,
  result: GameSeatAcceptanceResult,
  startedAt: Date,
): void {
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: readRequestId(request),
      actorId: viewer.userId,
      houseId: result.houseId,
      gameId: result.gameId,
      commandId: null,
      event: 'game.activated',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: {},
    });
  } catch {
    // A committed activation remains successful when diagnostics are unavailable.
  }
}

/** [BM-023] POST boundary for atomic Open-seat acceptance. */
export function acceptGameSeatCommandHandler(dependencies: GameSeatAcceptanceHandlerDependencies) {
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
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Game route is invalid.',
      );
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
        'Sign in to accept an Open seat.',
      );
    }
    try {
      const result = await dependencies.acceptGameSeat({ houseId, gameId, viewer });
      logActivation(dependencies, request, viewer, result, startedAt);
      return Response.json(
        { gameId: result.gameId, state: result.state },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
