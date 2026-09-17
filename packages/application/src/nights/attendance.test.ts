import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightAttendanceRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { joinNight, leaveNight } from './attendance';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const attendanceId = '01941f29-7c00-7000-8000-000000000902';
const scoringEventId = '01941f29-7c00-7000-8000-000000000903';
const joinEventId = '01941f29-7c00-7000-8000-000000000904';
const leaveEventId = '01941f29-7c00-7000-8000-000000000905';
const joinedAt = new Date('2026-09-04T14:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function dependencies(repository: Partial<NightAttendanceRepository> = {}) {
  const clock = new FakeClock(joinedAt);
  const ids = [attendanceId, joinEventId, leaveEventId, scoringEventId];
  const attendance: NightAttendanceRepository = {
    join: vi.fn(async (_context, input) => ({
      attendanceId: input.attendanceId,
      houseId,
      nightId,
      seasonId: '01941f29-7c00-7000-8000-000000000701',
      membershipId: '01941f29-7c00-7000-8000-000000000601',
      firstJoinedAt: input.joinedAt,
      currentJoinedAt: input.joinedAt,
      lastLeftAt: null,
      accumulatedSeconds: 0,
      qualifiedAt: null,
      qualificationReason: null,
      joinedNow: true,
    })),
    leave: vi.fn(async (_context, input) => ({
      attendanceId,
      houseId,
      nightId,
      seasonId: '01941f29-7c00-7000-8000-000000000701',
      membershipId: '01941f29-7c00-7000-8000-000000000601',
      firstJoinedAt: joinedAt,
      currentJoinedAt: null,
      lastLeftAt: input.leftAt,
      accumulatedSeconds: 900,
      qualifiedAt: input.leftAt,
      qualificationReason: 'duration' as const,
      leftNow: true,
      scoringEventEmitted: true,
      sourceKey: `night:${nightId}`,
    })),
    qualify: vi.fn(async () => null),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    attendance,
    clock,
    ids: { generate: vi.fn(() => ids.shift() ?? 'unexpected-id') },
    events: { record: vi.fn() },
    joinLeave: { record: vi.fn() },
  };
}

describe('Between Moves Night attendance commands', () => {
  it('[BM-036] [DR-NIGHT-02] records joins with server-owned time', async () => {
    const deps = dependencies();

    await expect(joinNight({ houseId, nightId, viewer }, deps)).resolves.toMatchObject({
      attendanceId,
      currentJoinedAt: joinedAt,
      joinedNow: true,
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.attendance.join).toHaveBeenCalledWith(context, {
      attendanceId,
      eventId: joinEventId,
      nightId,
      joinedAt,
    });
    expect(deps.joinLeave.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      attendanceId,
      houseId,
      nightId,
      change: 'join',
      outcome: 'success',
    });
  });

  it('[BM-036] [DR-NIGHT-05] records the unique attendance event after threshold', async () => {
    const deps = dependencies();
    deps.clock.advance(900_000);
    deps.ids.generate.mockReturnValueOnce(leaveEventId);
    deps.ids.generate.mockReturnValueOnce(scoringEventId);

    await expect(leaveNight({ houseId, nightId, viewer }, deps)).resolves.toMatchObject({
      scoringEventEmitted: true,
      sourceKey: `night:${nightId}`,
    });
    expect(deps.attendance.leave).toHaveBeenCalledWith(context, {
      nightId,
      eventId: leaveEventId,
      scoringEventId,
      leftAt: new Date('2026-09-04T14:15:00.000Z'),
    });
    expect(deps.joinLeave.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      attendanceId,
      houseId,
      nightId,
      change: 'leave',
      outcome: 'success',
    });
    expect(deps.events.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      attendanceId,
      houseId,
      nightId,
      sourceKey: `night:${nightId}`,
    });
  });

  it('[BM-036] does not log a scoring event when a leave is below threshold', async () => {
    const deps = dependencies({
      leave: vi.fn(async () => ({
        attendanceId,
        houseId,
        nightId,
        seasonId: '01941f29-7c00-7000-8000-000000000701',
        membershipId: '01941f29-7c00-7000-8000-000000000601',
        firstJoinedAt: joinedAt,
        currentJoinedAt: null,
        lastLeftAt: joinedAt,
        accumulatedSeconds: 0,
        qualifiedAt: null,
        qualificationReason: null,
        leftNow: true,
        scoringEventEmitted: false,
        sourceKey: null,
      })),
    });

    await leaveNight({ houseId, nightId, viewer }, deps);
    expect(deps.events.record).not.toHaveBeenCalled();
    expect(deps.joinLeave.record).toHaveBeenCalledWith(
      expect.objectContaining({ change: 'leave', outcome: 'success' }),
    );
  });

  it('[BM-036] does not log an idempotent rejoin or empty leave', async () => {
    const deps = dependencies({
      join: vi.fn(async (_context, input) => ({
        attendanceId: input.attendanceId,
        houseId,
        nightId,
        seasonId: '01941f29-7c00-7000-8000-000000000701',
        membershipId: '01941f29-7c00-7000-8000-000000000601',
        firstJoinedAt: input.joinedAt,
        currentJoinedAt: input.joinedAt,
        lastLeftAt: null,
        accumulatedSeconds: 0,
        qualifiedAt: null,
        qualificationReason: null,
        joinedNow: false,
      })),
      leave: vi.fn(async () => null),
    });

    await joinNight({ houseId, nightId, viewer }, deps);
    await leaveNight({ houseId, nightId, viewer }, deps);
    expect(deps.joinLeave.record).not.toHaveBeenCalled();
  });

  it('[BM-036] denies inactive or cross-House viewers before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(joinNight({ houseId, nightId, viewer }, deps)).rejects.toMatchObject({
      code: 'authorization_denied',
      crossHouse: true,
    });
    expect(deps.attendance.join).not.toHaveBeenCalled();
    expect(deps.joinLeave.record).not.toHaveBeenCalled();
  });

  it('[BM-036] logs a rejected join after authorization when persistence fails', async () => {
    const deps = dependencies({
      join: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', false);
      }),
    });

    await expect(joinNight({ houseId, nightId, viewer }, deps)).rejects.toMatchObject({
      code: 'authorization_denied',
    });
    expect(deps.joinLeave.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      attendanceId: null,
      houseId,
      nightId,
      change: 'join',
      outcome: 'rejected',
    });
  });
});
