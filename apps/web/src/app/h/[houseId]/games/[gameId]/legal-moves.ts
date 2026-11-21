import type { ChessMoveProposal, ChessSquare } from '@between-moves/domain';
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

/** What a proposal will most likely play, for the Undo window before the server answers. */
export function proposalOutcome(
  fen: string,
  proposal: ChessMoveProposal,
): { readonly san: string; readonly inCheck: boolean } | null {
  try {
    const game = new Chess(fen, { skipValidation: true });
    const { san } = game.move(proposal);
    return { san, inCheck: game.inCheck() };
  } catch {
    return null;
  }
}
