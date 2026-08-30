import { SystemClock } from '@between-moves/adapters';
import { getConfig } from '../../../../../config';
import { createHouseInvitation } from '../../../../../server/invitations';
import { getLogger } from '../../../../../server/logger';
import { getInvitationRateLimit } from '../../../../../server/rate-limit';
import { requireViewer } from '../../../../../server/viewer';
import { createInvitationRequestHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId } = await context.params;
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  return createInvitationRequestHandler({
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    rateLimit: getInvitationRateLimit(),
    createInvitation: (input) => createHouseInvitation(input, requestId),
    logger: getLogger(),
    clock: new SystemClock(),
  })(request, houseId);
}
