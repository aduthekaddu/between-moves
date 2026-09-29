import { cancelGameSeatCommandHandler } from '../../../../../../../server/game-seat-cancellation-handler';
import { gameSeatCancellationHandlerDependencies } from '../../../../../../../server/games';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

/** [BM-022] [BM-023] POST /api/houses/{houseId}/games/{gameId}/cancel. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return cancelGameSeatCommandHandler(gameSeatCancellationHandlerDependencies(request))(
    request,
    houseId,
    gameId,
  );
}
