import { gameReactionHandlerDependencies } from '../../../../../../../modules/stories/reactions';
import { createGameReactionHandler } from '../../../../../../../server/game-reaction-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

/** [BM-031] POST /api/houses/{houseId}/games/{gameId}/reactions. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createGameReactionHandler(gameReactionHandlerDependencies(request))(
    request,
    houseId,
    gameId,
  );
}
