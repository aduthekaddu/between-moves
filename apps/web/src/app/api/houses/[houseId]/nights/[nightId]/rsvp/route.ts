import { nightLifecycleHandlerDependencies } from '../../../../../../../modules/nights/lifecycle';
import { createRsvpNightHandler } from '../../../../../../../server/night-lifecycle-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-035] POST /api/houses/{houseId}/nights/{nightId}/rsvp. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createRsvpNightHandler(nightLifecycleHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
