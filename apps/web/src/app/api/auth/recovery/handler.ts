import type { RateLimitResult } from '@between-moves/domain';
import { z } from 'zod';

const bodySchema = z.object({ email: z.email() }).strict();
type RecoveryOutcome = 'accepted' | 'rejected' | 'error';

export interface RecoveryRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requestRecovery: (email: string, headers: Headers) => Promise<void>;
  readonly rateLimit: (request: Request, email: string) => Promise<RateLimitResult>;
  readonly metrics: { incrementRecoveryAttempt(outcome: RecoveryOutcome): void };
}

function empty(status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(null, { status, headers: responseHeaders });
}

/** [BM-010] [DR-ID-02] [DR-ID-03] Enumeration-safe account recovery request seam. */
export function createRecoveryRequestHandler(
  dependencies: RecoveryRequestHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      dependencies.metrics.incrementRecoveryAttempt('rejected');
      return empty(403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      dependencies.metrics.incrementRecoveryAttempt('rejected');
      return empty(422);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      dependencies.metrics.incrementRecoveryAttempt('rejected');
      return empty(422);
    }

    const rateLimit = await dependencies.rateLimit(request, parsed.data.email);
    if (!rateLimit.allowed) {
      dependencies.metrics.incrementRecoveryAttempt('rejected');
      return empty(429, {
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfterSeconds),
      });
    }

    try {
      await dependencies.requestRecovery(parsed.data.email, request.headers);
      dependencies.metrics.incrementRecoveryAttempt('accepted');
    } catch {
      dependencies.metrics.incrementRecoveryAttempt('error');
    }
    return empty(204);
  };
}
