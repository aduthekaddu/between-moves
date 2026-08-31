import { getConfig } from '../../../../config';
import { getAuth } from '../../../../server/auth';
import { getIdentityMetrics } from '../../../../server/identity-metrics';
import { getSignInRateLimit } from '../../../../server/rate-limit';
import { createMagicLinkRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  const handler = createMagicLinkRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    metrics: getIdentityMetrics(),
    rateLimit: getSignInRateLimit(),
    async requestMagicLink(email, headers, returnTo) {
      await getAuth().api.signInMagicLink({
        body: {
          email,
          name: 'Member',
          callbackURL: returnTo ?? '/',
          metadata: returnTo === null ? {} : { returnTo },
        },
        headers,
      });
    },
  });
  return handler(request);
}
