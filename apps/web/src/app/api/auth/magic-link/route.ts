import { getConfig } from '../../../../config';
import { getAuth } from '../../../../server/auth';
import { getIdentityMetrics } from '../../../../server/identity-metrics';
import { createMagicLinkRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  const handler = createMagicLinkRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    metrics: getIdentityMetrics(),
    async requestMagicLink(email, headers) {
      await getAuth().api.signInMagicLink({
        body: { email, name: 'Member', callbackURL: '/' },
        headers,
      });
    },
  });
  return handler(request);
}
