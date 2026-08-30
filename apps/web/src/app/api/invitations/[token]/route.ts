import { inspectHouseInvitation } from '../../../../server/invitations';
import { getInvitationRateLimit } from '../../../../server/rate-limit';
import { requireViewer } from '../../../../server/viewer';
import { createInspectInvitationRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  return createInspectInvitationRequestHandler({
    requireViewer,
    rateLimit: getInvitationRateLimit(),
    inspectInvitation: inspectHouseInvitation,
  })(request, token);
}
