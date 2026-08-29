import { getAuth } from '../../../../server/auth';
import { createMagicLinkCallbackHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GET = createMagicLinkCallbackHandler({
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
