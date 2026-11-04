import type { HeadToHead, SideToMove } from '@between-moves/domain';

/** The running score between the two players, told from the reader's side when they play. */
export function rivalryLine(input: {
  readonly headToHead: HeadToHead;
  readonly white: string;
  readonly black: string;
  readonly viewer: SideToMove | null;
}): string {
  const { whiteWins, blackWins, draws } = input.headToHead;
  const drawn = draws === 0 ? '' : ` · ${draws === 1 ? '1 draw' : `${draws} draws`}`;
  if (input.viewer === null) {
    return whiteWins + blackWins + draws === 0
      ? 'Their first game against each other'
      : `${input.white} ${whiteWins}–${blackWins} ${input.black}${drawn}`;
  }
  const opponent = input.viewer === 'white' ? input.black : input.white;
  const mine = input.viewer === 'white' ? whiteWins : blackWins;
  const theirs = input.viewer === 'white' ? blackWins : whiteWins;
  if (mine + theirs + draws === 0) return `Your first game against ${opponent}`;
  if (mine > theirs) return `You lead ${opponent} ${mine}–${theirs}${drawn}`;
  if (theirs > mine) return `${opponent} leads ${theirs}–${mine}${drawn}`;
  return `Level with ${opponent} at ${mine}–${theirs}${drawn}`;
}
