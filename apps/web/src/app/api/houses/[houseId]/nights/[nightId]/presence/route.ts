import { nightPresenceHandlerDependencies } from '../../../../../../../modules/nights/presence';
import { createChangeNightPresenceHandler } from '../../../../../../../server/night-presence-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-039] POST /api/houses/{houseId}/nights/{nightId}/presence. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createChangeNightPresenceHandler(nightPresenceHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
