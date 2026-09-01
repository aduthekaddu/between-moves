import { createChangeNightScheduleHandler } from '../../../../../../server/night-command-handler';
import { nightCommandHandlerDependencies } from '../../../../../../server/nights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createChangeNightScheduleHandler(nightCommandHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
