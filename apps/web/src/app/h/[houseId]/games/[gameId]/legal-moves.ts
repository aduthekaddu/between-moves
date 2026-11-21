import type { ChessMoveProposal, ChessSquare, SideToMove } from '@between-moves/domain';
import { Chess, type Move } from 'chess.js';

/** Each piece that can move, mapped to its destinations; `true` marks a destination that promotes. */
export type LegalMoves = ReadonlyMap<ChessSquare, ReadonlyMap<ChessSquare, boolean>>;

function verboseMoves(fen: string): Move[] {
  try {
    return new Chess(fen, { skipValidation: true }).moves({ verbose: true });
  } catch {
    return [];
  }
}

/** Board hints only. The server's rules adapter still decides every Move. */
export function legalMoves(fen: string): LegalMoves {
  const byFrom = new Map<ChessSquare, Map<ChessSquare, boolean>>();
  for (const move of verboseMoves(fen)) {
    const from = move.from as ChessSquare;
    const to = move.to as ChessSquare;
    const targets = byFrom.get(from) ?? new Map<ChessSquare, boolean>();
    targets.set(to, move.promotion !== undefined || targets.get(to) === true);
    byFrom.set(from, targets);
  }
  return byFrom;
}

/** Where a proposal will most likely lead, for the board before the server answers. */
export function proposalOutcome(
  fen: string,
  proposal: ChessMoveProposal,
): { readonly san: string; readonly fen: string } | null {
  try {
    const { san, after } = new Chess(fen, { skipValidation: true }).move(proposal);
    return { san, fen: after };
  } catch {
    return null;
  }
}

/** Who moves next in a position, and whether that side is in check. */
export function turnState(fen: string): {
  readonly sideToMove: SideToMove;
  readonly inCheck: boolean;
} {
  const sideToMove = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  try {
    return { sideToMove, inCheck: new Chess(fen, { skipValidation: true }).inCheck() };
  } catch {
    return { sideToMove, inCheck: false };
  }
}
