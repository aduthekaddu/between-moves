import { SystemClock } from '@between-moves/adapters';
import { getConfig } from '../../../../../../../config';
import { revokeHouseInvitation } from '../../../../../../../server/invitations';
import { getLogger } from '../../../../../../../server/logger';
import { requireViewer } from '../../../../../../../server/viewer';
import { createRevokeInvitationRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string; invitationId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, invitationId } = await context.params;
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  return createRevokeInvitationRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    revokeInvitation: (input) => revokeHouseInvitation(input, requestId),
    logger: getLogger(),
    clock: new SystemClock(),
  })(request, houseId, invitationId);
}
