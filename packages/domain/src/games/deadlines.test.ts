import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FakeClock } from '../testing/fake-clock';
import { nextMoveDueAt } from './deadlines';
import type { CorrespondenceClockPolicy } from './clock-policy';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;

function correspondencePace(perMoveHours: number): CorrespondenceClockPolicy {
  return { kind: 'correspondence', perMoveHours };
}

describe('correspondence Move deadlines', () => {
  it('[BM-025] [DR-CORR-01] advances move_due_at by the Game pace from the injected clock', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_147_483_647 }),
        fc.integer({ min: 0, max: 24 * 365 * MILLISECONDS_PER_HOUR }),
        (perMoveHours, elapsedMilliseconds) => {
          const clock = new FakeClock(new Date('2026-09-02T08:00:00.000Z'));
          clock.advance(elapsedMilliseconds);
          const now = clock.now();

          expect(nextMoveDueAt(now, correspondencePace(perMoveHours)).getTime()).toBe(
            now.getTime() + perMoveHours * MILLISECONDS_PER_HOUR,
          );
        },
      ),
    );
  });

  it('[BM-025] [DR-CORR-03] ignores a later Charter pace and uses only the Game snapshot', () => {
    const clock = new FakeClock(new Date('2026-09-02T09:00:00.000Z'));
    const gamePace = correspondencePace(48);
    const charterPaceHours = 24;

    const dueAt = nextMoveDueAt(clock.now(), gamePace);

    expect(dueAt).toEqual(new Date('2026-09-04T09:00:00.000Z'));
    expect(dueAt.getTime() - clock.now().getTime()).not.toBe(
      charterPaceHours * MILLISECONDS_PER_HOUR,
    );
  });

  it('[BM-025] [DR-CORR-01] rejects an invalid instant or non-positive pace', () => {
    const clock = new FakeClock(new Date('2026-09-02T08:00:00.000Z'));

    expect(() => nextMoveDueAt(new Date(Number.NaN), correspondencePace(48))).toThrow(
      'Invalid correspondence deadline instant',
    );
    expect(() => nextMoveDueAt(clock.now(), correspondencePace(0))).toThrow(
      'Correspondence pace must be a positive hour count',
    );
    expect(() => nextMoveDueAt(clock.now(), correspondencePace(1.5))).toThrow(
      'Correspondence pace must be a positive hour count',
    );
  });
});
