import { gameReactionBodySchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type GameReaction,
  type SetGameReactionRequest,
} from '@between-moves/domain';
import type { ReactionMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { ReactionRateLimit } from '../kernel/reaction-rate-limit';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 1_024;
const identifierSchema = z.string().uuid();

export interface GameReactionHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitReaction: ReactionRateLimit;
  readonly setGameReaction: (request: SetGameReactionRequest) => Promise<GameReaction>;
  readonly logger: StructuredLogger;
  readonly metrics: ReactionMetricStubs;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'Reaction details are invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

/** [BM-031] House-scoped POST boundary for current Game Reactions. */
export function createGameReactionHandler(dependencies: GameReactionHandlerDependencies) {
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
        'Sign in to react to this Game.',
      );
    }
    const rateLimit = await dependencies.limitReaction(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many Reactions',
        'Try reacting again shortly.',
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
        'Reaction details are too large.',
      );
    }
    if (body.kind === 'invalid') return validationProblem(request);
    const parsed = gameReactionBodySchema.safeParse(body.value);
    if (!parsed.success) return validationProblem(request);

    try {
      const result = await dependencies.setGameReaction({
        houseId,
        gameId,
        reaction: parsed.data.reaction,
        viewer,
      });
      try {
        dependencies.metrics.incrementReactionSet();
      } catch {
        // A committed Reaction remains successful when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
          actorId: viewer.userId,
          houseId,
          gameId,
          commandId: null,
          event: 'bm.reaction.set',
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: { reaction: result.reaction, actor_membership_id: result.membershipId },
        });
      } catch {
        // A committed Reaction remains successful when diagnostics are unavailable.
      }
      return Response.json(
        { reaction: result.reaction, reactedAt: result.reactedAt.toISOString() },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can react.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(
          request,
          404,
          'not_found',
          'Not found',
          'The completed Game is unavailable.',
        );
      }
      if (error instanceof DomainError && error.code === 'validation_failed') {
        return validationProblem(request, error.message);
      }
      throw error;
    }
  };
}
