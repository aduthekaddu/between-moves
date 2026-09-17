import { nightLifecycleHandlerDependencies } from '../../../../../../../modules/nights/lifecycle';
import { createStartNightHandler } from '../../../../../../../server/night-lifecycle-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-035] POST /api/houses/{houseId}/nights/{nightId}/start. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createStartNightHandler(nightLifecycleHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
