import type { RateLimitResult } from '@between-moves/domain';
import { z } from 'zod';
import { invitationReturnPath } from '../../../../kernel/invitation-return-path';

const bodySchema = z.object({ email: z.email(), returnTo: z.string().optional() }).strict();

interface SignInMetrics {
  incrementSignInAttempt(outcome: 'accepted' | 'rejected' | 'error'): void;
}

export interface MagicLinkRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requestMagicLink: (
    email: string,
    headers: Headers,
    returnTo: string | null,
  ) => Promise<void>;
  readonly rateLimit: (request: Request, email: string) => Promise<RateLimitResult>;
  readonly metrics: SignInMetrics;
}

function empty(status: number, headers?: HeadersInit): Response {
  return new Response(null, headers === undefined ? { status } : { status, headers });
}

/** [BM-008] [BM-009] [DR-ID-03] [DR-SEC-04] Enumeration-safe magic-link seam. */
export function createMagicLinkRequestHandler(
  dependencies: MagicLinkRequestHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      dependencies.metrics.incrementSignInAttempt('rejected');
      return empty(403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      dependencies.metrics.incrementSignInAttempt('rejected');
      return empty(422);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      dependencies.metrics.incrementSignInAttempt('rejected');
      return empty(422);
    }
    const returnTo = invitationReturnPath(parsed.data.returnTo);
    if (parsed.data.returnTo !== undefined && returnTo === null) {
      dependencies.metrics.incrementSignInAttempt('rejected');
      return empty(422);
    }

    const rateLimit = await dependencies.rateLimit(request, parsed.data.email);
    if (!rateLimit.allowed) {
      dependencies.metrics.incrementSignInAttempt('rejected');
      return empty(429, {
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfterSeconds),
      });
    }

    try {
      await dependencies.requestMagicLink(parsed.data.email, request.headers, returnTo);
      dependencies.metrics.incrementSignInAttempt('accepted');
    } catch {
      // Deliberately suppress account/provider details at the public enumeration boundary.
      dependencies.metrics.incrementSignInAttempt('error');
    }
    return empty(204);
  };
}
