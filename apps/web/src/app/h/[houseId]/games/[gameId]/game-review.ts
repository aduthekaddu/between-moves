import type { GamePositionMove } from '@between-moves/domain';
import { Chess } from 'chess.js';

function placement(fen: string): string {
  return fen.split(' ')[0] ?? '';
}

/**
 * The position after every Move, replayed from the standard start. Returns null when the replay
 * does not land on the server's board, so review stays off instead of showing a wrong position.
 */
export function replayPositions(
  moves: readonly GamePositionMove[],
  currentFen: string,
): readonly string[] | null {
  const chess = new Chess();
  const positions: string[] = [];
  try {
    for (const move of moves) {
      chess.move({
        from: move.uci.slice(0, 2),
        to: move.uci.slice(2, 4),
        ...(move.uci.length > 4 ? { promotion: move.uci.slice(4, 5) } : {}),
      });
      positions.push(chess.fen());
    }
  } catch {
    return null;
  }
  return placement(positions.at(-1) ?? chess.fen()) === placement(currentFen) ? positions : null;
}
