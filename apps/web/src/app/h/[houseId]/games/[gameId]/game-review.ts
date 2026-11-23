import type { GamePositionMove } from '@between-moves/domain';
import { Chess } from 'chess.js';
import { requireFen, type Fen } from './board-model';

const STANDARD_START = requireFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

/** A Move the way a scoresheet names it: "2. Nf3" for White, "2… Nc6" for Black. */
export function moveLabel(move: Pick<GamePositionMove, 'ply' | 'san'>): string {
  const number = Math.ceil(move.ply / 2);
  return move.ply % 2 === 1 ? `${number}. ${move.san}` : `${number}… ${move.san}`;
}

function placement(fen: string): string {
  return fen.split(' ')[0] ?? '';
}

/**
 * The position after each number of Moves, from the standard start at index 0. Returns null when
 * the replay does not land on the server's board, so review stays off instead of showing a wrong
 * position.
 */
export function replayPositions(
  moves: readonly GamePositionMove[],
  currentFen: Fen,
): readonly Fen[] | null {
  const chess = new Chess(STANDARD_START);
  const positions: Fen[] = [STANDARD_START];
  try {
    for (const move of moves) {
      chess.move({
        from: move.uci.slice(0, 2),
        to: move.uci.slice(2, 4),
        ...(move.uci.length > 4 ? { promotion: move.uci.slice(4, 5) } : {}),
      });
      positions.push(requireFen(chess.fen()));
    }
  } catch {
    return null;
  }
  return placement(positions.at(-1)!) === placement(currentFen) ? positions : null;
}
