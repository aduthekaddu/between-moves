import { nightRealtimeTokenHandlerDependencies } from '../../../../../../../modules/nights/realtimeToken';
import { createMintRealtimeTokenHandler } from '../../../../../../../server/night-realtime-token-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-037] POST /api/houses/{houseId}/nights/{nightId}/realtime-token. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createMintRealtimeTokenHandler(nightRealtimeTokenHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
