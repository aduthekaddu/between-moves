import { createDrawGameHandler } from '../../../../../../../server/game-completion-handler';
import { gameCompletionHandlerDependencies } from '../../../../../../../server/games';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createDrawGameHandler(gameCompletionHandlerDependencies(request))(
    request,
    houseId,
    gameId,
  );
}
