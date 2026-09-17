import {
  AuthenticationRequiredError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createChangeNightScheduleHandler } from './night-command-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown, origin = 'https://app.example.test') {
  return new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    changeNightSchedule: vi.fn(async () => ({
      changedNow: true,
      night: {
        nightId,
        houseId,
        seasonId: '01941f29-7c00-7000-8000-000000000701',
        scheduledStart: new Date('2026-09-05T14:00:00.000Z'),
        scheduledEnd: new Date('2026-09-05T16:00:00.000Z'),
        state: 'scheduled' as const,
        hostMembershipId: null,
        startedAt: null,
        endedAt: null,
        viewerIsHost: false,
        viewerRsvp: null,
      },
    })),
    ...overrides,
  };
}

describe('BM-020 Night schedule command boundary', () => {
  it('parses and dispatches a reschedule', async () => {
    const deps = dependencies();
    const response = await createChangeNightScheduleHandler(deps)(
      request({
        scheduledStart: '2026-09-05T14:00:00.000Z',
        scheduledEnd: '2026-09-05T16:00:00.000Z',
      }),
      houseId,
      nightId,
    );

    expect(response.status).toBe(200);
    expect(deps.changeNightSchedule).toHaveBeenCalledWith({
      houseId,
      nightId,
      command: {
        kind: 'reschedule',
        scheduledStart: new Date('2026-09-05T14:00:00.000Z'),
        scheduledEnd: new Date('2026-09-05T16:00:00.000Z'),
      },
      viewer,
    });
  });

  it('dispatches cancellation and denies a Member', async () => {
    const deps = dependencies({
      changeNightSchedule: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('role_not_permitted', false);
      }),
    });
    const response = await createChangeNightScheduleHandler(deps)(
      request({ state: 'cancelled' }),
      houseId,
      nightId,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });

  it('rejects invalid intervals and origins before the command', async () => {
    const deps = dependencies();
    const interval = await createChangeNightScheduleHandler(deps)(
      request({
        scheduledStart: '2026-09-05T16:00:00.000Z',
        scheduledEnd: '2026-09-05T14:00:00.000Z',
      }),
      houseId,
      nightId,
    );
    const origin = await createChangeNightScheduleHandler(deps)(
      request({ state: 'cancelled' }, 'https://evil.example.test'),
      houseId,
      nightId,
    );

    expect(interval.status).toBe(422);
    expect(origin.status).toBe(403);
    expect(deps.changeNightSchedule).not.toHaveBeenCalled();
  });

  it('requires an authenticated viewer', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createChangeNightScheduleHandler(deps)(
      request({ state: 'cancelled' }),
      houseId,
      nightId,
    );
    expect(response.status).toBe(401);
  });
});
