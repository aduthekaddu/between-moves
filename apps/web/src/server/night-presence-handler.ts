import {
  nightPresenceCommandSchema,
  nightPresenceResponseSchema,
  type NightPresenceCommandBody,
} from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightPresenceRequest,
  type NightPresenceSnapshot,
  type RateLimitResult,
} from '@between-moves/domain';
import type { RealtimeMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 64 * 1_024;
const identifier = z.string().uuid();

export interface NightPresenceHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitPresence: (request: Request, accountId: string) => Promise<RateLimitResult>;
  readonly changePresence: (request: NightPresenceRequest) => Promise<NightPresenceSnapshot>;
  readonly logger: StructuredLogger;
  readonly metrics: RealtimeMetricStubs;
  readonly clock: { now(): Date };
}

function routeProblem(request: Request): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', 'Presence is invalid.');
}

function body(value: unknown): NightPresenceCommandBody | null {
  const parsed = nightPresenceCommandSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** [BM-039] Authenticated command boundary for ephemeral Night presence. */
export function createChangeNightPresenceHandler(dependencies: NightPresenceHandlerDependencies) {
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
        'Sign in to join Night presence.',
      );
    }

    const rateLimit = await dependencies.limitPresence(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many presence updates',
        'Try updating presence again shortly.',
        { headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const read = await readJsonBody(request, MAXIMUM_BODY_BYTES);
    if (read.kind === 'too_large') {
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Presence details are too large.',
      );
    }
    if (read.kind === 'invalid') return routeProblem(request);
    const command = body(read.value);
    if (command === null) return routeProblem(request);

    try {
      const snapshot = await dependencies.changePresence({ houseId, nightId, viewer, command });
      const payload = nightPresenceResponseSchema.parse({
        presence: snapshot.members,
        presenceCount: snapshot.members.length,
      });
      try {
        dependencies.metrics.setPresenceCount(payload.presenceCount);
      } catch {
        // Presence remains correct when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
          actorId: viewer.userId,
          houseId,
          gameId: null,
          commandId: null,
          event: `night.presence-${command.kind}`,
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: { night_id: nightId, presence_count: payload.presenceCount },
        });
      } catch {
        // Presence remains correct when diagnostics are unavailable.
      }
      return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can join Night presence.',
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
