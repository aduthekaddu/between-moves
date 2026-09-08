import type { GamePositionMove, SideToMove } from '@between-moves/domain';

export interface MoveEntryPosition {
  readonly currentFen: string;
  readonly currentPly: number;
  readonly sideToMove: SideToMove;
  readonly version: number;
  readonly state: 'active' | 'completed';
  readonly viewerColor: SideToMove | null;
  readonly white: { readonly name: string };
  readonly black: { readonly name: string };
  readonly moveDueAt: Date | string | null;
  readonly result: 'white_win' | 'black_win' | 'draw' | 'aborted' | null;
  readonly inCheck: boolean;
  readonly moves: readonly GamePositionMove[];
}

export interface AcceptedMoveBody {
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
  readonly fenAfter: string;
  readonly sideToMove: SideToMove;
  readonly version: number;
}

export function acceptedMove(value: unknown): AcceptedMoveBody | null {
  if (value === null || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.ply !== 'number' ||
    !Number.isInteger(body.ply) ||
    typeof body.uci !== 'string' ||
    typeof body.san !== 'string' ||
    typeof body.fenAfter !== 'string' ||
    (body.sideToMove !== 'white' && body.sideToMove !== 'black') ||
    typeof body.version !== 'number' ||
    !Number.isInteger(body.version)
  ) {
    return null;
  }
  return body as unknown as AcceptedMoveBody;
}

export function conflictPosition(value: unknown) {
  if (value === null || typeof value !== 'object') return null;
  const problem = value as Record<string, unknown>;
  if (
    problem.code !== 'move_conflict' ||
    problem.meta === null ||
    typeof problem.meta !== 'object'
  ) {
    return null;
  }
  const meta = problem.meta as Record<string, unknown>;
  if (
    typeof meta.version !== 'number' ||
    !Number.isInteger(meta.version) ||
    typeof meta.currentPly !== 'number' ||
    !Number.isInteger(meta.currentPly) ||
    typeof meta.fen !== 'string'
  ) {
    return null;
  }
  const turn = meta.fen.split(' ')[1];
  if (turn !== 'w' && turn !== 'b') return null;
  return {
    version: meta.version,
    currentPly: meta.currentPly,
    currentFen: meta.fen,
    sideToMove: turn === 'w' ? ('white' as const) : ('black' as const),
  };
}

export function moveEntryPosition(value: unknown): MoveEntryPosition | null {
  if (value === null || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const white = body.white as Record<string, unknown> | null;
  const black = body.black as Record<string, unknown> | null;
  if (
    typeof body.currentFen !== 'string' ||
    typeof body.currentPly !== 'number' ||
    !Number.isInteger(body.currentPly) ||
    (body.sideToMove !== 'white' && body.sideToMove !== 'black') ||
    typeof body.version !== 'number' ||
    !Number.isInteger(body.version) ||
    (body.state !== 'active' && body.state !== 'completed') ||
    (body.viewerColor !== null && body.viewerColor !== 'white' && body.viewerColor !== 'black') ||
    white === null ||
    typeof white !== 'object' ||
    typeof white.name !== 'string' ||
    black === null ||
    typeof black !== 'object' ||
    typeof black.name !== 'string' ||
    (body.moveDueAt !== null &&
      (typeof body.moveDueAt !== 'string' || Number.isNaN(Date.parse(body.moveDueAt)))) ||
    (body.result !== null &&
      body.result !== 'white_win' &&
      body.result !== 'black_win' &&
      body.result !== 'draw' &&
      body.result !== 'aborted') ||
    typeof body.inCheck !== 'boolean' ||
    !Array.isArray(body.moves)
  ) {
    return null;
  }
  const moves = body.moves.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return null;
    const move = candidate as Record<string, unknown>;
    return typeof move.ply === 'number' &&
      Number.isInteger(move.ply) &&
      typeof move.uci === 'string' &&
      typeof move.san === 'string'
      ? { ply: move.ply, uci: move.uci, san: move.san }
      : null;
  });
  if (moves.some((move) => move === null)) return null;
  return { ...(body as unknown as MoveEntryPosition), moves: moves as GamePositionMove[] };
}
