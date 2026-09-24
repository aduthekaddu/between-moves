import type { GamePosition } from '@between-moves/domain';
import { z } from 'zod';
import { problemResponse } from '../../../../../../kernel/request';
import { getGamePosition } from '../../../../../../modules/games/game-position';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly gameId: string }>;
}

const identifierSchema = z.string().uuid();

type PositionReader = (
  request: Request,
  houseId: string,
  gameId: string,
) => Promise<GamePosition | null>;

function responseBody(position: GamePosition) {
  return {
    ...position,
    ...(position.mode === 'live' ? { serverNow: new Date().toISOString() } : {}),
    moveDueAt: position.moveDueAt?.toISOString() ?? null,
    ...(position.liveClock === undefined
      ? {}
      : {
          liveClock: {
            whiteMs: position.liveClock.whiteMs,
            blackMs: position.liveClock.blackMs,
            turnStartedAt: position.liveClock.turnStartedAt?.toISOString() ?? null,
          },
        }),
  };
}

function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

export async function createGamePositionResponse(
  request: Request,
  houseId: string,
  gameId: string,
  readPosition: PositionReader,
): Promise<Response> {
  if (!identifierSchema.safeParse(houseId).success || !identifierSchema.safeParse(gameId).success) {
    return problemResponse(request, 404, 'not_found', 'Not found', 'The Game is unavailable.');
  }
  const position = await readPosition(request, houseId, gameId);
  if (position === null) {
    return problemResponse(request, 404, 'not_found', 'Not found', 'The Game is unavailable.');
  }

  const etag = `"${position.version}"`;
  const headers = { 'Cache-Control': 'private, no-store', ETag: etag };
  // A live clock changes with server time even when the board version is unchanged.
  if (position.mode !== 'live' && matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json(responseBody(position), { headers });
}

/** [BM-027] Authorized repair read for command reconciliation and reconnects. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, gameId } = await context.params;
  return createGamePositionResponse(request, houseId, gameId, getGamePosition);
}
