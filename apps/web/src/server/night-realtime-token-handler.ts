import { realtimeTokenHidesRootKey, realtimeTokenResponseSchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type IssuedRealtimeToken,
  type MintRealtimeTokenRequest,
} from '@between-moves/domain';
import type { RealtimeMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { RealtimeTokenRateLimit } from '../kernel/realtime-token-rate-limit';
import { problemResponse as problem, readRequestId } from '../kernel/request';

const identifier = z.string().uuid();

export interface NightRealtimeTokenHandlerDependencies {
  readonly expectedOrigin: string;
  readonly realtimeServerKey: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitRealtimeToken: RealtimeTokenRateLimit;
  readonly mintRealtimeToken: (request: MintRealtimeTokenRequest) => Promise<IssuedRealtimeToken>;
  readonly logger: StructuredLogger;
  readonly metrics: RealtimeMetricStubs;
  readonly clock: { now(): Date };
}

function routeProblem(request: Request): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', 'Night route is invalid.');
}

function clientPayload(issued: IssuedRealtimeToken) {
  return realtimeTokenResponseSchema.parse({
    token: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
    clientId: issued.clientId,
    publicKey: issued.publicKey,
    channels: issued.channels,
    presence: issued.presence,
  });
}

/** [BM-037] HTTP boundary for short-lived Night-scoped realtime capability tokens. */
export function createMintRealtimeTokenHandler(
  dependencies: NightRealtimeTokenHandlerDependencies,
) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
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
    if (!identifier.safeParse(houseId).success || !identifier.safeParse(nightId).success) {
      return routeProblem(request);
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
        'Sign in to request a realtime token.',
      );
    }
    const rateLimit = await dependencies.limitRealtimeToken(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many realtime tokens',
        'Try requesting a realtime token again shortly.',
        { headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }
    try {
      const issued = await dependencies.mintRealtimeToken({ houseId, nightId, viewer });
      const payload = clientPayload(issued);
      if (!realtimeTokenHidesRootKey(payload, dependencies.realtimeServerKey)) {
        throw new Error('Realtime token payload contained the provider root key');
      }
      try {
        dependencies.metrics.incrementRealtimeTokenIssue();
      } catch {
        // A minted token remains successful when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: readRequestId(request),
          actorId: viewer.userId,
          houseId,
          gameId: null,
          commandId: null,
          event: 'realtime.token-issued',
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: {
            night_id: nightId,
            game_count: payload.channels.games.length,
          },
        });
      } catch {
        // A minted token remains successful when diagnostics are unavailable.
      }
      return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can request a realtime token.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(request, 404, 'not_found', 'Not found', 'Night is unavailable.');
      }
      if (error instanceof DomainError && error.code === 'validation_failed') {
        return routeProblem(request);
      }
      throw error;
    }
  };
}
