import { membershipAdminHandlerDependencies } from '../../../../../server/membership-admin';
import { createLeaveHouseHandler } from '../../../../../server/membership-admin-handler';
import { readRequestId } from '../../../../../server/membership-admin-handler-support';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string }> };

/** [BM-015] [DR-MEM-05] Route-scoped House leave command. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId } = await context.params;
  const requestId = readRequestId(request);
  return createLeaveHouseHandler(membershipAdminHandlerDependencies(requestId))(request, houseId);
}
