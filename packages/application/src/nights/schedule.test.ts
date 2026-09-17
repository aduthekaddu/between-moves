import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { changeNightSchedule, readScheduledNights } from './schedule';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function dependencies(repository: Partial<NightRepository> = {}) {
  const nights: NightRepository = {
    list: vi.fn(async () => []),
    change: vi.fn(async (_context, input) => ({
      night: {
        nightId,
        houseId,
        seasonId: '01941f29-7c00-7000-8000-000000000701',
        scheduledStart:
          input.command.kind === 'reschedule'
            ? input.command.scheduledStart
            : new Date('2026-09-04T14:00:00.000Z'),
        scheduledEnd:
          input.command.kind === 'reschedule'
            ? input.command.scheduledEnd
            : new Date('2026-09-04T16:00:00.000Z'),
        state: input.command.kind === 'cancel' ? ('cancelled' as const) : ('scheduled' as const),
        hostMembershipId: null,
        startedAt: null,
        endedAt: null,
        viewerIsHost: false,
        viewerRsvp: null,
      },
      changedNow: true,
    })),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: () => new Date('2026-09-01T12:00:00.000Z') },
    ids: { generate: vi.fn(() => '01941f29-7c00-7000-8000-000000000911') },
    nights,
    changes: { record: vi.fn() },
  };
}

describe('Between Moves Night schedule commands', () => {
  it('[BM-020] [DR-NIGHT-03] lets an Owner/Steward reschedule a Night and records it', async () => {
    const deps = dependencies();
    const scheduledStart = new Date('2026-09-05T15:00:00.000Z');
    const scheduledEnd = new Date('2026-09-05T17:00:00.000Z');

    await expect(
      changeNightSchedule(
        {
          houseId,
          nightId,
          command: { kind: 'reschedule', scheduledStart, scheduledEnd },
          viewer,
        },
        deps,
      ),
    ).resolves.toMatchObject({ night: { scheduledStart, scheduledEnd, state: 'scheduled' } });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'schedule_night' },
      houseId,
      viewer,
    );
    expect(deps.nights.change).toHaveBeenCalledWith(context, {
      nightId,
      auditId: '01941f29-7c00-7000-8000-000000000911',
      command: { kind: 'reschedule', scheduledStart, scheduledEnd },
      changedAt: new Date('2026-09-01T12:00:00.000Z'),
    });
    expect(deps.changes.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: viewer.userId,
        houseId,
        nightId,
        change: 'rescheduled',
        outcome: 'success',
      }),
    );
  });

  it('[BM-020] [DR-NIGHT-03] cancels a scheduled Night', async () => {
    const deps = dependencies();
    await expect(
      changeNightSchedule({ houseId, nightId, command: { kind: 'cancel' }, viewer }, deps),
    ).resolves.toMatchObject({ night: { state: 'cancelled' } });
  });

  it('[BM-020] [DR-PERM-01] denies a Member before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('role_not_permitted', false),
    );

    await expect(
      changeNightSchedule({ houseId, nightId, command: { kind: 'cancel' }, viewer }, deps),
    ).rejects.toMatchObject({ code: 'authorization_denied', reason: 'role_not_permitted' });
    expect(deps.nights.change).not.toHaveBeenCalled();
  });

  it('[BM-020] authorizes the scheduled Nights read as House content', async () => {
    const deps = dependencies();
    await expect(readScheduledNights({ houseId, viewer }, deps)).resolves.toEqual([]);
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.nights.list).toHaveBeenCalledWith(context);
  });
});
