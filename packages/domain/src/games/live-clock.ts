import { DomainError } from '../shared/errors';
import type { LiveClockPolicy } from './clock-policy';
import type { SideToMove } from './rules-adapter';

export const MINIMUM_LIVE_INITIAL_MS = 180_000;
export const MAXIMUM_LIVE_CLOCK_MS = 2_147_483_647;

export function validateLiveClockPolicy(policy: LiveClockPolicy): void {
  if (
    !Number.isInteger(policy.initialMs) ||
    policy.initialMs < MINIMUM_LIVE_INITIAL_MS ||
    policy.initialMs > MAXIMUM_LIVE_CLOCK_MS ||
    !Number.isInteger(policy.incrementMs) ||
    policy.incrementMs < 0 ||
    policy.incrementMs > MAXIMUM_LIVE_CLOCK_MS
  ) {
    throw new DomainError('validation_failed', 'Live clock control is invalid');
  }
}

export interface LiveClockState {
  readonly whiteMs: number;
  readonly blackMs: number;
  readonly turnStartedAt: Date;
}

export interface LiveClockTransition extends LiveClockState {
  readonly flagged: boolean;
}

/** The server alone spends time; an increment is earned only by a timely completed move. */
export function advanceLiveClock(
  state: LiveClockState,
  side: SideToMove,
  receivedAt: Date,
  incrementMs: number,
  completedMove: boolean,
  nextTurnAt: Date = receivedAt,
): LiveClockTransition {
  const elapsed = Math.max(0, receivedAt.getTime() - state.turnStartedAt.getTime());
  const remaining = side === 'white' ? state.whiteMs : state.blackMs;
  const spent = Math.max(0, remaining - elapsed);
  const flagged = spent === 0;
  const next =
    flagged || !completedMove ? spent : Math.min(MAXIMUM_LIVE_CLOCK_MS, spent + incrementMs);
  return {
    whiteMs: side === 'white' ? next : state.whiteMs,
    blackMs: side === 'black' ? next : state.blackMs,
    turnStartedAt: new Date(
      Math.max(nextTurnAt.getTime(), receivedAt.getTime(), state.turnStartedAt.getTime()),
    ),
    flagged,
  };
}
