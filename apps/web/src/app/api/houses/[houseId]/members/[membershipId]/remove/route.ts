import { membershipAdminHandlerDependencies } from '../../../../../../../server/membership-admin';
import { createRemoveHouseMemberHandler } from '../../../../../../../server/membership-admin-handler';
import { readRequestId } from '../../../../../../../kernel/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string; membershipId: string }> };

/** [BM-015] [DR-MEM-06] Route-scoped Member removal command. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, membershipId } = await context.params;
  const requestId = readRequestId(request);
  return createRemoveHouseMemberHandler(membershipAdminHandlerDependencies(requestId))(
    request,
    houseId,
    membershipId,
  );
}
