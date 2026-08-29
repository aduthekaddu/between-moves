import { getConfig } from '../../../../config';
import { getAuth } from '../../../../server/auth';
import { verifyMagicLinkPurpose } from '../../../../server/magic-link-purpose';
import { createMagicLinkCallbackHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GET = createMagicLinkCallbackHandler({
  isExpectedPurpose(token, proof) {
    return verifyMagicLinkPurpose(getConfig().betterAuthSecret, 'signin', token, proof);
  },
  async verifyMagicLink(token, headers) {
    return getAuth().api.magicLinkVerify({
      query: {
        token,
        callbackURL: '/',
        errorCallbackURL: '/auth/link-invalid',
      },
      headers,
      asResponse: true,
    });
  },
});

export { GET };
