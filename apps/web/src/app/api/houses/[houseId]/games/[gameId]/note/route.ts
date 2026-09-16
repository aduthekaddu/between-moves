import { gameNoteHandlerDependencies } from '../../../../../../../modules/stories/notes';
import { createGameNoteHandler } from '../../../../../../../server/game-note-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

/** [BM-032] POST /api/houses/{houseId}/games/{gameId}/note. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createGameNoteHandler(gameNoteHandlerDependencies(request))(request, houseId, gameId);
}
