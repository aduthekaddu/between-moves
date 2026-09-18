import { createReadNightRailHandler } from '../../../../../../../server/night-rail-handler';
import { getNightRail } from '../../../../../../../modules/nights/rail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-038] GET /api/houses/{houseId}/nights/{nightId}/rail. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createReadNightRailHandler({ readNightRail: getNightRail })(request, houseId, nightId);
}
