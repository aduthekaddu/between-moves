import { nightAttendanceHandlerDependencies } from '../../../../../../../modules/nights/attendance';
import { createLeaveNightHandler } from '../../../../../../../server/night-attendance-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-033] POST /api/houses/{houseId}/nights/{nightId}/leave. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createLeaveNightHandler(nightAttendanceHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
