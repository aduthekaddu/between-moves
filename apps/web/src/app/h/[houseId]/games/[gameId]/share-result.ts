import type { GamePositionMove } from '@between-moves/domain';

/** Short enough for a group chat: a full short game, or only the last move of a long one. */
const FULL_SCORESHEET_PLIES = 16;

function scoresheet(moves: readonly GamePositionMove[]): string {
  return moves
    .map((move) => (move.ply % 2 === 1 ? `${(move.ply + 1) / 2}. ${move.san}` : move.san))
    .join(' ');
}

/** The text a player shares about a finished Game. */
export function shareResult(input: {
  readonly headline: string;
  readonly moves: readonly GamePositionMove[];
  readonly url: string;
}): string {
  const fullMoves = Math.ceil(input.moves.length / 2);
  const last = input.moves.at(-1);
  const lines = [
    fullMoves === 0
      ? `${input.headline}.`
      : `${input.headline} in ${fullMoves} ${fullMoves === 1 ? 'move' : 'moves'}.`,
  ];
  if (last !== undefined) {
    lines.push(
      input.moves.length <= FULL_SCORESHEET_PLIES
        ? scoresheet(input.moves)
        : `Last move: ${last.san}`,
    );
  }
  lines.push(`Between Moves · ${input.url}`);
  return lines.join('\n');
}
