import { membershipAdminHandlerDependencies } from '../../../../../server/membership-admin';
import { createTransferHouseOwnershipHandler } from '../../../../../server/membership-admin-handler';
import { readRequestId } from '../../../../../kernel/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ houseId: string }> };

/** [BM-015] [DR-HOUSE-02] Route-scoped ownership transfer command. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId } = await context.params;
  const requestId = readRequestId(request);
  return createTransferHouseOwnershipHandler(membershipAdminHandlerDependencies(requestId))(
    request,
    houseId,
  );
}
