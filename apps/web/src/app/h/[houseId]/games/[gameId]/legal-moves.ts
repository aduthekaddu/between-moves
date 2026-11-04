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

/** The SAN a proposal will most likely get, for the Undo bar before the server answers. */
export function proposalSan(fen: string, proposal: ChessMoveProposal): string | null {
  try {
    return new Chess(fen, { skipValidation: true }).move(proposal).san;
  } catch {
    return null;
  }
}
