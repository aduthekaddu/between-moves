import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  createDraftSeasonHandler,
  createDraftSeasonCharterHandler,
  createPublishSeasonHandler,
} from './season-command-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const endpoint = `https://app.example.test/api/houses/${houseId}/seasons`;
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function post(
  path: string,
  body: unknown,
  origin = 'https://app.example.test',
  idempotencyKey: string | null = 'draft-request-bm-019',
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    origin,
    'x-request-id': 'request-bm-019',
  });
  if (idempotencyKey !== null) headers.set('idempotency-key', idempotencyKey);
  return new Request(`${endpoint}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let now = Date.parse('2026-09-01T12:00:00.000Z');
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    draftSeason: vi.fn(async () => ({
      seasonId,
      houseId,
      state: 'draft' as const,
      createdNow: true,
    })),
    draftSeasonCharter: vi.fn(async () => ({ seasonId, version: 1 })),
    publishSeason: vi.fn(async () => ({
      seasonId,
      houseId,
      state: 'active' as const,
      publishedCharterVersion: 1,
      activatedNow: true,
      actorMembershipId: '01941f29-7c00-7000-8000-000000000202',
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: {
      now: () => {
        const value = new Date(now);
        now += 12;
        return value;
      },
    },
    ...overrides,
  };
}

describe('BM-019 Season command request boundary', () => {
  it('creates a House-scoped draft Season', async () => {
    const deps = dependencies();
    const response = await createDraftSeasonHandler(deps)(
      post('', { title: ' Autumn tables ' }),
      houseId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ seasonId, state: 'draft' });
    expect(deps.draftSeason).toHaveBeenCalledWith({
      houseId,
      title: 'Autumn tables',
      idempotencyKey: 'draft-request-bm-019',
      viewer,
    });
  });

  it('supports an omitted draft title and requires an Idempotency-Key', async () => {
    const deps = dependencies();
    const accepted = await createDraftSeasonHandler(deps)(post('', {}), houseId);
    expect(accepted.status).toBe(201);
    expect(deps.draftSeason).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Untitled Season' }),
    );

    const rejected = await createDraftSeasonHandler(deps)(
      post('', { title: 'Autumn tables' }, 'https://app.example.test', null),
      houseId,
    );
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({
      errors: { 'Idempotency-Key': expect.any(Array) },
    });
  });

  it('versions a strictly validated Charter with the fixed recurrence count', async () => {
    const deps = dependencies();
    const response = await createDraftSeasonCharterHandler(deps)(
      post(`/${seasonId}/charter`, {
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seasonId, version: 1 });
    expect(deps.draftSeasonCharter).toHaveBeenCalledWith({
      houseId,
      seasonId,
      correspondencePaceHours: 24,
      nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      viewer,
    });
  });

  it('publishes an exact four-week Season and logs the analytics event', async () => {
    const deps = dependencies();
    const response = await createPublishSeasonHandler(deps)(
      post(`/${seasonId}/publish`, {
        title: 'Autumn tables',
        startsAt: '2026-09-04T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      seasonId,
      state: 'active',
      publishedCharterVersion: 1,
    });
    expect(deps.publishSeason).toHaveBeenCalledWith({
      houseId,
      seasonId,
      title: 'Autumn tables',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      viewer,
    });
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-bm-019',
        actorId: viewer.userId,
        houseId,
        event: 'bm.season.published',
        outcome: 'success',
        data: {
          season_id: seasonId,
          charter_version: 1,
          actor_membership_id: '01941f29-7c00-7000-8000-000000000202',
        },
      }),
    );
  });

  it('does not turn a committed publication into a failure when logging is unavailable', async () => {
    const deps = dependencies({
      logger: {
        log: vi.fn(() => {
          throw new Error('log sink unavailable');
        }),
      } satisfies StructuredLogger,
    });
    const response = await createPublishSeasonHandler(deps)(
      post(`/${seasonId}/publish`, {
        title: 'Autumn tables',
        startsAt: '2026-09-04T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'active' });
  });

  it.each([
    [
      'draft',
      () => createDraftSeasonHandler(dependencies()),
      post('', { title: '', unexpected: true }),
      { title: expect.any(Array), unexpected: expect.any(Array) },
    ],
    [
      'Charter',
      () => createDraftSeasonCharterHandler(dependencies()),
      post(`/${seasonId}/charter`, {
        correspondencePaceHours: 2_147_483_648,
        nightRecurrence: { weekday: 9, localTime: '25:00', count: 3 },
      }),
      {
        correspondencePaceHours: expect.any(Array),
        'nightRecurrence.weekday': expect.any(Array),
        'nightRecurrence.localTime': expect.any(Array),
        'nightRecurrence.count': expect.any(Array),
      },
    ],
    [
      'publish',
      () => createPublishSeasonHandler(dependencies()),
      post(`/${seasonId}/publish`, {
        title: '',
        startsAt: 'not-a-date',
        endsAt: '2026-09-05T00:00:00.000Z',
      }),
      { title: expect.any(Array), startsAt: expect.any(Array) },
    ],
  ])('returns field-level errors for invalid %s input', async (_name, factory, request, fields) => {
    const response = await factory()(request, houseId, seasonId);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'validation_failed', errors: fields });
  });

  it('associates a non-four-week window error with endsAt', async () => {
    const response = await createPublishSeasonHandler(dependencies())(
      post(`/${seasonId}/publish`, {
        title: 'Autumn tables',
        startsAt: '2026-09-04T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: { endsAt: expect.any(Array) } });
  });

  it('denies a Member attempting to publish', async () => {
    const deps = dependencies({
      publishSeason: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('role_not_permitted', false);
      }),
    });
    const response = await createPublishSeasonHandler(deps)(
      post(`/${seasonId}/publish`, {
        title: 'Autumn tables',
        startsAt: '2026-09-04T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
    expect(deps.logger.log).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthenticationRequiredError(), 401, 'unauthenticated'],
    [new DomainError('not_found', 'Season unavailable'), 404, 'not_found'],
    [new DomainError('conflict', 'Another Season is active'), 409, 'season_conflict'],
    [new DomainError('idempotency_conflict', 'Key was reused'), 409, 'idempotency_conflict'],
  ])('maps command failure %# without leaking internals', async (error, status, code) => {
    const deps = dependencies({
      requireViewer:
        error instanceof AuthenticationRequiredError
          ? vi.fn(async () => {
              throw error;
            })
          : vi.fn(async () => viewer),
      publishSeason: vi.fn(async () => {
        throw error;
      }),
    });
    const response = await createPublishSeasonHandler(deps)(
      post(`/${seasonId}/publish`, {
        title: 'Autumn tables',
        startsAt: '2026-09-04T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
      }),
      houseId,
      seasonId,
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it('rejects an untrusted origin before resolving the viewer', async () => {
    const deps = dependencies();
    const response = await createDraftSeasonHandler(deps)(
      post('', { title: 'Autumn tables' }, 'https://evil.example.test'),
      houseId,
    );

    expect(response.status).toBe(403);
    expect(deps.requireViewer).not.toHaveBeenCalled();
  });
});
