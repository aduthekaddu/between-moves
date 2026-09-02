import { acceptGameSeatCommandHandler } from '../../../../../../../server/game-seat-acceptance-handler';
import { gameSeatAcceptanceHandlerDependencies } from '../../../../../../../server/games';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return acceptGameSeatCommandHandler(gameSeatAcceptanceHandlerDependencies(request))(
    request,
    houseId,
    gameId,
  );
}
