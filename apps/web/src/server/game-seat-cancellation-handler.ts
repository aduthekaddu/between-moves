import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type CancelGameSeatRequest,
  type GameSeatCancellationResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readRequestId } from '../kernel/request';

const identifierSchema = z.string().uuid();

export interface GameSeatCancellationHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly cancelGameSeat: (request: CancelGameSeatRequest) => Promise<GameSeatCancellationResult>;
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
      'Only the Member who opened the seat, or the Member it challenges, can cancel it.',
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

function logCancellation(
  dependencies: GameSeatCancellationHandlerDependencies,
  request: Request,
  viewer: AuthenticatedViewer,
  result: GameSeatCancellationResult,
  startedAt: Date,
): void {
  if (!result.cancelledNow) return;
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: readRequestId(request),
      actorId: viewer.userId,
      houseId: result.houseId,
      gameId: result.gameId,
      commandId: null,
      event: 'seat.cancelled',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: { cancelled_by: result.cancelledBy },
    });
  } catch {
    // A committed cancellation remains successful when diagnostics are unavailable.
  }
}

/** [BM-022] [BM-023] POST boundary for withdrawing an Open seat or declining a challenge. */
export function cancelGameSeatCommandHandler(
  dependencies: GameSeatCancellationHandlerDependencies,
) {
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
        'Sign in to cancel an Open seat.',
      );
    }
    try {
      const result = await dependencies.cancelGameSeat({ houseId, gameId, viewer });
      logCancellation(dependencies, request, viewer, result, startedAt);
      return Response.json(
        { gameId: result.gameId, state: result.state, cancelledBy: result.cancelledBy },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      const response = commandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
