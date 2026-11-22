import { HouseAuthorizationDeniedError, type AuthenticatedViewer } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createAssignNightHostHandler,
  createEndNightHandler,
  createRsvpNightHandler,
  createStartNightHandler,
  type NightLifecycleHandlerDependencies,
} from './night-lifecycle-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const hostMembershipId = '01941f29-7c00-7000-8000-000000000601';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body?: unknown, origin = 'https://app.example.test') {
  return new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function night(state: 'scheduled' | 'live' | 'ended' = 'live') {
  return {
    nightId,
    houseId,
    seasonId: '01941f29-7c00-7000-8000-000000000701',
    scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
    scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
    state,
    hostMembershipId,
    startedAt: state === 'scheduled' ? null : new Date('2026-09-04T14:00:00.000Z'),
    endedAt: state === 'ended' ? new Date('2026-09-04T16:00:00.000Z') : null,
    viewerIsHost: true,
    viewerRsvp: null,
  };
}

function dependencies(
  overrides: Partial<NightLifecycleHandlerDependencies> = {},
): NightLifecycleHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    startNight: vi.fn(async () => ({ night: night('live'), changedNow: true })),
    endNight: vi.fn(async () => ({ night: night('ended'), changedNow: true })),
    assignNightHost: vi.fn(async () => ({ night: night('scheduled'), changedNow: true })),
    rsvpNight: vi.fn(async (input) => ({
      rsvpId: '01941f29-7c00-7000-8000-000000000912',
      houseId: input.houseId,
      nightId: input.nightId,
      membershipId: hostMembershipId,
      status: input.status,
      respondedAt: new Date('2026-09-01T12:00:00.000Z'),
    })),
    ...overrides,
  };
}

describe('BM-035 Night lifecycle command boundary', () => {
  it('starts a Night and denies a Member without host duty', async () => {
    const ok = dependencies();
    const started = await createStartNightHandler(ok)(request(), houseId, nightId);
    expect(started.status).toBe(200);
    expect(ok.startNight).toHaveBeenCalledWith({ houseId, nightId, viewer });

    const denied = dependencies({
      startNight: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('night_host_not_assigned', false);
      }),
    });
    const response = await createStartNightHandler(denied)(request(), houseId, nightId);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
  });

  it('ends a Night and assigns a temporary host', async () => {
    const deps = dependencies();
    const ended = await createEndNightHandler(deps)(request(), houseId, nightId);
    expect(ended.status).toBe(200);
    const assigned = await createAssignNightHostHandler(deps)(
      request({ hostMembershipId }),
      houseId,
      nightId,
    );
    expect(assigned.status).toBe(200);
    expect(deps.assignNightHost).toHaveBeenCalledWith({
      houseId,
      nightId,
      hostMembershipId,
      viewer,
    });
  });

  it('records RSVP and rejects a bad origin before persistence', async () => {
    const deps = dependencies();
    const rsvp = await createRsvpNightHandler(deps)(request({ status: 'going' }), houseId, nightId);
    expect(rsvp.status).toBe(200);
    await expect(rsvp.json()).resolves.toMatchObject({ status: 'going' });
    const origin = await createStartNightHandler(deps)(
      request(undefined, 'https://evil.example.test'),
      houseId,
      nightId,
    );
    expect(origin.status).toBe(403);
    expect(deps.startNight).not.toHaveBeenCalled();
  });
});
