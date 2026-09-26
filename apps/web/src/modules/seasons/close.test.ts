import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type SeasonCloseResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createCloseSeasonHandler, type CloseSeasonHandlerDependencies } from './close';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const origin = 'https://app.example.test';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const closed: SeasonCloseResult = {
  seasonId,
  houseId,
  state: 'closed',
  closedAt: new Date('2026-10-02T13:00:00.000Z'),
  standings: [
    { membershipId: '01941f29-7c00-7000-8000-000000000202', points: 7, rank: 1 },
    { membershipId: '01941f29-7c00-7000-8000-000000000203', points: 2, rank: 2 },
  ],
  closedNow: true,
  actorMembershipId: '01941f29-7c00-7000-8000-000000000202',
};

function post(requestOrigin = origin): Request {
  return new Request(`${origin}/api/houses/${houseId}/seasons/${seasonId}/close`, {
    method: 'POST',
    headers: { origin: requestOrigin, 'x-request-id': 'request-bm-047' },
  });
}

function dependencies(
  overrides: Partial<CloseSeasonHandlerDependencies> = {},
): CloseSeasonHandlerDependencies & {
  readonly logger: StructuredLogger & { log: ReturnType<typeof vi.fn> };
} {
  let now = Date.parse('2026-10-02T13:00:00.000Z');
  return {
    expectedOrigin: origin,
    requireViewer: vi.fn(async () => viewer),
    closeSeason: vi.fn(async () => closed),
    logger: { log: vi.fn() },
    clock: {
      now: () => {
        const value = new Date(now);
        now += 25;
        return value;
      },
    },
    ...overrides,
  } as CloseSeasonHandlerDependencies & {
    readonly logger: StructuredLogger & { log: ReturnType<typeof vi.fn> };
  };
}

describe('BM-047 POST /api/houses/{houseId}/seasons/{seasonId}/close', () => {
  it('closes the Season, returns final standings, and logs season.closed', async () => {
    const deps = dependencies();
    const response = await createCloseSeasonHandler(deps)(post(), houseId, seasonId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      seasonId,
      state: 'closed',
      closedAt: '2026-10-02T13:00:00.000Z',
      standings: closed.standings,
    });
    expect(deps.closeSeason).toHaveBeenCalledWith({ houseId, seasonId, viewer });
    expect(deps.logger.log).toHaveBeenCalledTimes(1);
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-bm-047',
      actorId: viewer.userId,
      houseId,
      gameId: null,
      commandId: null,
      event: 'season.closed',
      outcome: 'success',
      durationMs: 25,
      data: {
        season_id: seasonId,
        actor_membership_id: closed.actorMembershipId,
        standings_count: 2,
      },
    });
  });

  it('replays an already closed Season without a duplicate season.closed log', async () => {
    const deps = dependencies({
      closeSeason: vi.fn(async () => ({ ...closed, closedNow: false })),
    });
    const response = await createCloseSeasonHandler(deps)(post(), houseId, seasonId);

    expect(response.status).toBe(200);
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it('keeps a committed close when the log sink fails', async () => {
    const deps = dependencies();
    deps.logger.log.mockImplementation(() => {
      throw new Error('sink unavailable');
    });

    await expect(createCloseSeasonHandler(deps)(post(), houseId, seasonId)).resolves.toMatchObject({
      status: 200,
    });
  });

  it('rejects a cross-site origin before resolving the viewer', async () => {
    const deps = dependencies();
    const response = await createCloseSeasonHandler(deps)(
      post('https://evil.example.test'),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'origin_rejected' });
    expect(deps.requireViewer).not.toHaveBeenCalled();
    expect(deps.closeSeason).not.toHaveBeenCalled();
  });

  it('rejects malformed route identifiers', async () => {
    const deps = dependencies();
    const response = await createCloseSeasonHandler(deps)(post(), houseId, 'not-a-season');

    expect(response.status).toBe(422);
    expect(deps.closeSeason).not.toHaveBeenCalled();
  });

  it('requires a signed-in viewer', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createCloseSeasonHandler(deps)(post(), houseId, seasonId);

    expect(response.status).toBe(401);
    expect(deps.closeSeason).not.toHaveBeenCalled();
  });

  it('denies a Member with a close-specific message', async () => {
    const deps = dependencies({
      closeSeason: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('role_not_permitted', false);
      }),
    });
    const response = await createCloseSeasonHandler(deps)(post(), houseId, seasonId);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'forbidden',
      detail: 'Only an Owner or Steward can close a Season.',
    });
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it.each([
    [new DomainError('not_found', 'Season is unavailable'), 404, 'not_found'],
    [new DomainError('conflict', 'Only an active Season can be closed'), 409, 'season_conflict'],
  ])('maps %s to a problem response', async (error, status, code) => {
    const deps = dependencies({
      closeSeason: vi.fn(async () => {
        throw error;
      }),
    });
    const response = await createCloseSeasonHandler(deps)(post(), houseId, seasonId);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it('rethrows unexpected failures for the platform error boundary', async () => {
    const deps = dependencies({
      closeSeason: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });

    await expect(createCloseSeasonHandler(deps)(post(), houseId, seasonId)).rejects.toThrow(
      'connection reset',
    );
  });
});
