import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type HouseNightView,
  type NightLifecycleRepository,
  type NightRsvpRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  assignNightHost,
  endNight,
  readNightHostCandidates,
  rsvpNight,
  startNight,
} from './lifecycle';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const hostMembershipId = '01941f29-7c00-7000-8000-000000000601';
const eventId = '01941f29-7c00-7000-8000-000000000911';
const rsvpId = '01941f29-7c00-7000-8000-000000000912';
const at = new Date('2026-09-04T14:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function nightView(overrides: Partial<HouseNightView> = {}): HouseNightView {
  return {
    nightId,
    houseId,
    seasonId: '01941f29-7c00-7000-8000-000000000701',
    scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
    scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
    state: 'scheduled',
    hostMembershipId: null,
    startedAt: null,
    endedAt: null,
    viewerIsHost: false,
    viewerRsvp: null,
    ...overrides,
  };
}

function dependencies(
  repository: Partial<NightLifecycleRepository> = {},
  rsvps: Partial<NightRsvpRepository> = {},
) {
  const lifecycle: NightLifecycleRepository = {
    start: vi.fn(async (_context, input) => ({
      night: nightView({
        state: 'live',
        startedAt: input.at,
        hostMembershipId,
        viewerIsHost: true,
      }),
      changedNow: true,
    })),
    end: vi.fn(async (_context, input) => ({
      night: nightView({
        state: 'ended',
        hostMembershipId,
        startedAt: at,
        endedAt: input.at,
        viewerIsHost: true,
      }),
      changedNow: true,
    })),
    assignHost: vi.fn(async (_context, input) => ({
      night: nightView({ hostMembershipId: input.hostMembershipId, viewerIsHost: false }),
      changedNow: true,
    })),
    listHostCandidates: vi.fn(async () => []),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: new FakeClock(at),
    ids: { generate: vi.fn(() => eventId) },
    lifecycle,
    rsvps: {
      rsvp: vi.fn(async (_context, input) => ({
        rsvpId: input.rsvpId,
        houseId,
        nightId,
        membershipId: hostMembershipId,
        status: input.status,
        respondedAt: input.respondedAt,
      })),
      ...rsvps,
    },
    changes: { record: vi.fn() },
  };
}

describe('Between Moves Night lifecycle commands', () => {
  it('[BM-035] [DR-NIGHT-03] starts a Night with server time and records it', async () => {
    const deps = dependencies();

    await expect(startNight({ houseId, nightId, viewer }, deps)).resolves.toMatchObject({
      night: { state: 'live', startedAt: at },
      changedNow: true,
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'start_or_end_assigned_night', nightId, operation: 'start' },
      houseId,
      viewer,
    );
    expect(deps.lifecycle.start).toHaveBeenCalledWith(context, { nightId, eventId, at });
    expect(deps.changes.record).toHaveBeenCalledWith({
      actorId: viewer.userId,
      houseId,
      nightId,
      change: 'start',
      outcome: 'success',
    });
  });

  it('[BM-035] [DR-NIGHT-03] lets an assigned host end a Night with server time', async () => {
    const deps = dependencies();
    deps.clock.advance(7_200_000);
    const endedAt = new Date('2026-09-04T16:00:00.000Z');

    await expect(endNight({ houseId, nightId, viewer }, deps)).resolves.toMatchObject({
      night: { state: 'ended', endedAt },
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'start_or_end_assigned_night', nightId, operation: 'end' },
      houseId,
      viewer,
    );
    expect(deps.lifecycle.end).toHaveBeenCalledWith(context, {
      nightId,
      eventId,
      at: endedAt,
      settlementIds: deps.ids,
    });
    expect(deps.changes.record).toHaveBeenCalledWith(
      expect.objectContaining({ change: 'end', outcome: 'success' }),
    );
  });

  it('[BM-035] [DR-PERM-02] denies a Member without host duty before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('night_host_not_assigned', false),
    );

    await expect(startNight({ houseId, nightId, viewer }, deps)).rejects.toMatchObject({
      code: 'authorization_denied',
      reason: 'night_host_not_assigned',
    });
    expect(deps.lifecycle.start).not.toHaveBeenCalled();
    expect(deps.changes.record).not.toHaveBeenCalled();
  });

  it('[BM-035] does not log an idempotent start as a new state edge', async () => {
    const deps = dependencies({
      start: vi.fn(async () => ({
        night: nightView({ state: 'live', startedAt: at, viewerIsHost: true }),
        changedNow: false,
      })),
    });

    await expect(startNight({ houseId, nightId, viewer }, deps)).resolves.toMatchObject({
      changedNow: false,
    });
    expect(deps.changes.record).not.toHaveBeenCalled();
  });

  it('[BM-035] [DR-PERM-02] assigns a Night host without a permanent role change', async () => {
    const deps = dependencies();

    await expect(
      assignNightHost({ houseId, nightId, hostMembershipId, viewer }, deps),
    ).resolves.toMatchObject({ night: { hostMembershipId } });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'schedule_night' },
      houseId,
      viewer,
    );
    expect(deps.lifecycle.assignHost).toHaveBeenCalledWith(context, {
      nightId,
      hostMembershipId,
      assignedAt: at,
    });
  });

  it('[BM-035] [DR-NIGHT-06] records RSVP with server-owned time', async () => {
    const deps = dependencies();
    deps.ids.generate.mockReturnValue(rsvpId);

    await expect(rsvpNight({ houseId, nightId, status: 'going', viewer }, deps)).resolves.toEqual({
      rsvpId,
      houseId,
      nightId,
      membershipId: hostMembershipId,
      status: 'going',
      respondedAt: at,
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.rsvps.rsvp).toHaveBeenCalledWith(context, {
      rsvpId,
      nightId,
      status: 'going',
      respondedAt: at,
    });
  });

  it('[BM-035] [DR-SEC-01] authorizes host-candidate reads as House content', async () => {
    const deps = dependencies({
      listHostCandidates: vi.fn(async () => [
        { membershipId: hostMembershipId, displayName: 'Bea' },
      ]),
    });
    await expect(readNightHostCandidates({ houseId, viewer }, deps)).resolves.toEqual([
      { membershipId: hostMembershipId, displayName: 'Bea' },
    ]);
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(deps.lifecycle.listHostCandidates).toHaveBeenCalledWith(context);
  });
});
