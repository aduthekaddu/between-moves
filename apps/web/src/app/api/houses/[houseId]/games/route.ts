import { createGameSeatCommandHandler } from '../../../../../server/game-seat-command-handler';
import { gameSeatCommandHandlerDependencies } from '../../../../../server/games';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId } = await context.params;
  return createGameSeatCommandHandler(gameSeatCommandHandlerDependencies(request))(
    request,
    houseId,
  );
}
