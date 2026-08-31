import { getConfig } from '../../../../../config';
import { redeemHouseInvitation } from '../../../../../server/invitations';
import { getLogger } from '../../../../../server/logger';
import { getInvitationRateLimit } from '../../../../../server/rate-limit';
import { requireViewer } from '../../../../../server/viewer';
import { createRedeemInvitationRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  return createRedeemInvitationRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    rateLimit: getInvitationRateLimit(),
    redeemInvitation: redeemHouseInvitation,
    logger: getLogger(),
    clock: { now: () => new Date() },
  })(request, token);
}
