import type { GameCompletionReason } from '@between-moves/domain';

interface Ending {
  /** The whole result in one line, for example "Asha won by checkmate". */
  readonly headline: (winner: string | null, loser: string | null) => string;
}

const endings: Readonly<Record<GameCompletionReason, Ending>> = {
  checkmate: { headline: (winner) => `${winner} won by checkmate` },
  resign: { headline: (winner, loser) => `${loser} resigned. ${winner} won` },
  flag: { headline: (winner, loser) => `${loser} ran out of time. ${winner} won` },
  timeout: { headline: (winner, loser) => `${loser} ran out of time. ${winner} won` },
  stalemate: { headline: () => 'Drawn by stalemate' },
  insufficient_material: { headline: () => 'Drawn: nobody can checkmate' },
  repetition: { headline: () => 'Drawn by repetition' },
  fifty_move: { headline: () => 'Drawn by the fifty-move rule' },
  agreement: { headline: () => 'Drawn by agreement' },
};

export function isGameCompletionReason(value: unknown): value is GameCompletionReason {
  return typeof value === 'string' && Object.hasOwn(endings, value);
}

/** One plain line that says who won and how, or that it was drawn and why. */
export function endingHeadline(input: {
  readonly result: 'white_win' | 'black_win' | 'draw' | 'aborted' | null;
  readonly resultReason?: GameCompletionReason | null | undefined;
  readonly white: string;
  readonly black: string;
}): string {
  const winner =
    input.result === 'white_win' ? input.white : input.result === 'black_win' ? input.black : null;
  const loser =
    input.result === 'white_win' ? input.black : input.result === 'black_win' ? input.white : null;
  const reason = input.resultReason ?? null;
  if (reason !== null && (winner !== null || input.result === 'draw')) {
    return endings[reason].headline(winner, loser);
  }
  if (winner !== null) return `${winner} won`;
  if (input.result === 'draw') return 'Game drawn';
  return 'Game ended';
}
