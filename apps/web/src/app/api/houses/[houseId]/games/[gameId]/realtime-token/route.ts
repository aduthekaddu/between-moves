import { gameRealtimeDependencies } from '../../../../../../../modules/games/realtime';
import { createGameRealtimeTokenHandler } from '../../../../../../../server/game-realtime-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly houseId: string; readonly gameId: string }> },
): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createGameRealtimeTokenHandler(gameRealtimeDependencies())(request, houseId, gameId);
}
