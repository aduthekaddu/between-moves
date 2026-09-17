import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createJoinNightHandler,
  createLeaveNightHandler,
  type NightAttendanceHandlerDependencies,
} from './night-attendance-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(origin = 'https://app.example.test') {
  return new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}`, {
    method: 'POST',
    headers: { origin },
  });
}

function dependencies(
  overrides: Partial<NightAttendanceHandlerDependencies> = {},
): NightAttendanceHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    joinNight: vi.fn(async (input) => ({
      attendanceId: '01941f29-7c00-7000-8000-000000000902',
      houseId: input.houseId,
      nightId: input.nightId,
      seasonId: '01941f29-7c00-7000-8000-000000000701',
      membershipId: '01941f29-7c00-7000-8000-000000000601',
      firstJoinedAt: new Date('2026-09-04T14:00:00.000Z'),
      currentJoinedAt: new Date('2026-09-04T14:00:00.000Z'),
      lastLeftAt: null,
      accumulatedSeconds: 0,
      qualifiedAt: null,
      qualificationReason: null,
    })),
    leaveNight: vi.fn(async () => null),
    ...overrides,
  };
}

describe('BM-033 Night attendance command boundary', () => {
  it('records a durable join and returns its attendance ID', async () => {
    const deps = dependencies();
    const response = await createJoinNightHandler(deps)(request(), houseId, nightId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attendanceId: '01941f29-7c00-7000-8000-000000000902',
    });
    expect(deps.joinNight).toHaveBeenCalledWith({ houseId, nightId, viewer });
  });

  it('records an idempotent durable leave', async () => {
    const deps = dependencies();
    const response = await createLeaveNightHandler(deps)(request(), houseId, nightId);

    expect(response.status).toBe(204);
    expect(deps.leaveNight).toHaveBeenCalledWith({ houseId, nightId, viewer });
  });

  it('rejects invalid origins and unauthenticated joins before persistence', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const origin = await createJoinNightHandler(deps)(
      request('https://evil.example.test'),
      houseId,
      nightId,
    );
    const unauthenticated = await createJoinNightHandler(deps)(request(), houseId, nightId);

    expect(origin.status).toBe(403);
    expect(unauthenticated.status).toBe(401);
    expect(deps.joinNight).not.toHaveBeenCalled();
  });

  it('maps House denials and unavailable Nights without leaking state', async () => {
    const denied = dependencies({
      joinNight: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    const unavailable = dependencies({
      joinNight: vi.fn(async () => {
        throw new DomainError('not_found', 'Live Night is unavailable');
      }),
    });

    expect((await createJoinNightHandler(denied)(request(), houseId, nightId)).status).toBe(403);
    expect((await createJoinNightHandler(unavailable)(request(), houseId, nightId)).status).toBe(
      404,
    );
  });
});
