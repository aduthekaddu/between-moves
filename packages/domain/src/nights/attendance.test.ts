import { DomainError } from '../shared/errors';
import { describe, expect, it } from 'vitest';
import {
  accumulatedAttendanceSeconds,
  crossedAttendanceDurationThreshold,
  NIGHT_ATTENDANCE_THRESHOLD_SECONDS,
  nightAttendanceSourceKey,
} from './attendance';

const joinedAt = new Date('2026-09-04T14:00:00.000Z');

describe('Between Moves Night attendance accrual', () => {
  it('[BM-036] [DR-NIGHT-02] accrues closed-interval seconds from server time', () => {
    expect(
      accumulatedAttendanceSeconds({
        accumulatedSeconds: 120,
        currentJoinedAt: joinedAt,
        at: new Date('2026-09-04T14:10:00.500Z'),
      }),
    ).toBe(720);
    expect(
      accumulatedAttendanceSeconds({
        accumulatedSeconds: 120,
        currentJoinedAt: null,
        at: new Date('2026-09-04T14:10:00.000Z'),
      }),
    ).toBe(120);
  });

  it('[BM-036] rejects a leave that precedes the current join', () => {
    expect(() =>
      accumulatedAttendanceSeconds({
        accumulatedSeconds: 0,
        currentJoinedAt: joinedAt,
        at: new Date('2026-09-04T13:59:59.000Z'),
      }),
    ).toThrow(DomainError);
  });

  it('[BM-036] [DR-NIGHT-05] crosses the 15-minute threshold once', () => {
    expect(
      crossedAttendanceDurationThreshold({
        alreadyQualified: false,
        previousSeconds: NIGHT_ATTENDANCE_THRESHOLD_SECONDS - 1,
        accumulatedSeconds: NIGHT_ATTENDANCE_THRESHOLD_SECONDS,
      }),
    ).toBe(true);
    expect(
      crossedAttendanceDurationThreshold({
        alreadyQualified: false,
        previousSeconds: 600,
        accumulatedSeconds: 899,
      }),
    ).toBe(false);
    expect(
      crossedAttendanceDurationThreshold({
        alreadyQualified: true,
        previousSeconds: 600,
        accumulatedSeconds: 960,
      }),
    ).toBe(false);
    expect(nightAttendanceSourceKey('night-1')).toBe('night:night-1');
  });
});
