import { z } from 'zod';

const bodySchema = z.object({ email: z.email() }).strict();

interface SignInMetrics {
  incrementSignInAttempt(outcome: 'accepted' | 'rejected' | 'error'): void;
}

export interface MagicLinkRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requestMagicLink: (email: string, headers: Headers) => Promise<void>;
  readonly metrics: SignInMetrics;
}

function empty(status: number): Response {
  return new Response(null, { status });
}

/** [BM-008] [DR-ID-03] Uniform for valid emails; malformed and cross-origin requests fail. */
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

    try {
      await dependencies.requestMagicLink(parsed.data.email, request.headers);
      dependencies.metrics.incrementSignInAttempt('accepted');
    } catch {
      // Deliberately suppress account/provider details at the public enumeration boundary.
      dependencies.metrics.incrementSignInAttempt('error');
    }
    return empty(204);
  };
}
