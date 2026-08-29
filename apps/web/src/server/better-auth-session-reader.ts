import type { SessionIdentityReader } from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';

interface BetterAuthSessionResult {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly image?: string | null | undefined;
  };
}

export interface BetterAuthSessionApi {
  readonly api: {
    getSession(input: {
      readonly headers: Headers;
      readonly query: { readonly disableCookieCache: true };
    }): Promise<BetterAuthSessionResult | null>;
  };
}

/** [BM-007] [DR-ID-01] Adapt the untrusted request to Better Auth's DB validation. */
export function createBetterAuthSessionReader(
  auth: BetterAuthSessionApi,
  logger: StructuredLogger,
): SessionIdentityReader<Request> {
  return {
    async read(request) {
      const startedAt = performance.now();
      const result = await auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      });
      const actorId = result?.user.id ?? 'anonymous';

      logger.log({
        level: 'info',
        requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
        actorId,
        houseId: null,
        gameId: null,
        commandId: null,
        event: 'identity.session.resolved',
        outcome: result === null ? 'rejected' : 'success',
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });

      return result === null
        ? null
        : {
            userId: result.user.id,
            displayName: result.user.name,
            imageUrl: result.user.image ?? null,
          };
    },
  };
}
