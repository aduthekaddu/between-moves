import { submitMoveHandlerDependencies } from '../../../../../../../server/games';
import { createSubmitMoveHandler } from '../../../../../../../server/submit-move-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createSubmitMoveHandler(submitMoveHandlerDependencies(request))(request, houseId, gameId);
}
