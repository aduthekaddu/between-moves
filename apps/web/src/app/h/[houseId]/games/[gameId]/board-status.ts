import { endingHeadline } from './game-ending';
import type { MoveEntryPosition } from './move-entry-wire';

export type StatusTone = 'yours' | 'waiting' | 'won' | 'lost' | 'drawn' | 'quiet';

export interface BoardStatus {
  readonly headline: string;
  readonly tone: StatusTone;
}

/** The one line a player reads first: whose move it is, or how the Game ended. */
export function boardStatus(input: {
  readonly position: MoveEntryPosition;
  readonly fresh: boolean;
  readonly narrowLive: boolean;
  readonly pending: boolean;
}): BoardStatus {
  const { position } = input;
  const viewer = position.viewerColor;
  if (position.state === 'completed') {
    const headline = endingHeadline({
      result: position.result,
      resultReason: position.resultReason,
      white: position.white.name,
      black: position.black.name,
      viewer,
    });
    if (position.result === 'draw') return { headline, tone: 'drawn' };
    if (viewer === null || position.result === null || position.result === 'aborted') {
      return { headline, tone: 'quiet' };
    }
    return { headline, tone: position.result === `${viewer}_win` ? 'won' : 'lost' };
  }
  if (!input.fresh) return { headline: 'Refreshing the board', tone: 'quiet' };
  const mover = position[position.sideToMove].name;
  if (viewer === null) return { headline: `${mover} to move`, tone: 'quiet' };
  if (input.narrowLive) return { headline: 'Widen your window to make a Move', tone: 'quiet' };
  if (input.pending) return { headline: 'Sending your Move', tone: 'yours' };
  if (viewer === position.sideToMove) return { headline: 'Your move', tone: 'yours' };
  return { headline: `Waiting on ${mover}`, tone: 'waiting' };
}
