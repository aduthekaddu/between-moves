import { membershipAdminHandlerDependencies } from '../../../../../../../server/membership-admin';
import { createChangeMembershipRoleHandler } from '../../../../../../../server/membership-admin-handler';
import { readRequestId } from '../../../../../../../kernel/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string; membershipId: string }> };

/** [BM-015] [DR-PERM-01] Route-scoped permanent-role command. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, membershipId } = await context.params;
  const requestId = readRequestId(request);
  return createChangeMembershipRoleHandler(membershipAdminHandlerDependencies(requestId))(
    request,
    houseId,
    membershipId,
  );
}
