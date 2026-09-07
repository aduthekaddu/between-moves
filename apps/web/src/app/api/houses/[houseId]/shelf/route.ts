import type { MoveShelf } from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse } from '../../../../../kernel/request';
import { getMoveShelf, type MoveShelfReader } from '../../../../../modules/games/move-shelf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const houseIdSchema = z.string().uuid();

function shelfResponse(shelf: MoveShelf) {
  return {
    yourMove: shelf.yourMove.map((game) => ({
      gameId: game.gameId,
      opponent: game.opponentName,
      moveDueAt: game.moveDueAt.toISOString(),
      ply: game.ply,
    })),
    waiting: shelf.waiting.map((game) => ({
      gameId: game.gameId,
      opponent: game.opponentName,
      moveDueAt: game.moveDueAt.toISOString(),
    })),
    recent: shelf.recent.map((game) => ({
      gameId: game.gameId,
      result: game.result,
      completedAt: game.completedAt.toISOString(),
    })),
  };
}

/** [BM-026] [DR-SHELF-01] Return the documented ordered Move Shelf groups. */
export async function createMoveShelfResponse(
  request: Request,
  houseId: string,
  readShelf: MoveShelfReader = getMoveShelf,
): Promise<Response> {
  if (!houseIdSchema.safeParse(houseId).success) {
    return problemResponse(
      request,
      422,
      'validation_failed',
      'Validation failed',
      'House ID is invalid.',
    );
  }

  const shelf = await readShelf(request, houseId);
  if (shelf === null) {
    return problemResponse(
      request,
      404,
      'not_found',
      'House not available',
      'This House is not available.',
    );
  }

  return Response.json(shelfResponse(shelf), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

interface ShelfRouteContext {
  readonly params: Promise<{ readonly houseId: string }>;
}

export async function GET(request: Request, context: ShelfRouteContext): Promise<Response> {
  const { houseId } = await context.params;
  return createMoveShelfResponse(request, houseId);
}
