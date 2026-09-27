import { AuthenticationRequiredError, DomainError } from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createHouseRequestHandler } from './handler';

const endpoint = 'https://app.example.test/api/houses';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown, origin = 'https://app.example.test'): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-request-id': 'request-bm-011',
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let clockMilliseconds = Date.parse('2026-08-30T00:00:00.000Z');
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    createHouse: vi.fn(async () => ({
      houseId: '01941f29-7c00-7000-8000-000000000201',
      ownerMembershipId: '01941f29-7c00-7000-8000-000000000202',
      slug: '01941f29-7c00-7000-8000-000000000201',
      emblemSeed: 'house:01941f29-7c00-7000-8000-000000000201',
      timeZone: 'Asia/Calcutta',
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: {
      now: () => {
        const value = new Date(clockMilliseconds);
        clockMilliseconds += 10;
        return value;
      },
    },
    ...overrides,
  };
}

describe('POST /api/houses', () => {
  it('[BM-011] [PR-JRN-01] creates a House for an authenticated viewer and logs AE-01', async () => {
    const deps = dependencies();
    const handler = createHouseRequestHandler(deps);

    const response = await handler(
      request({ name: 'Knights at Dusk', description: 'Weekly games', timeZone: 'Asia/Kolkata' }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      houseId: '01941f29-7c00-7000-8000-000000000201',
      slug: '01941f29-7c00-7000-8000-000000000201',
    });
    expect(deps.createHouse).toHaveBeenCalledWith(
      { name: 'Knights at Dusk', description: 'Weekly games', timeZone: 'Asia/Kolkata' },
      viewer,
    );
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-bm-011',
      actorId: viewer.userId,
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'bm.house.created',
      outcome: 'success',
      durationMs: 10,
      data: { owner_membership_id: '01941f29-7c00-7000-8000-000000000202' },
    });
  });

  it('[BM-011] rejects anonymous creation with RFC 9457 problem details', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const response = await createHouseRequestHandler(deps)(
      request({ name: 'House', timeZone: 'UTC' }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(deps.createHouse).not.toHaveBeenCalled();
  });

  it.each([
    ['unexpected origin', request({ name: 'House', timeZone: 'UTC' }, 'https://evil.test'), 403],
    ['malformed fields', request({ name: '', timeZone: 'UTC', role: 'owner' }), 422],
    ['an oversized body', request({ name: 'House', timeZone: 'x'.repeat(9_000) }), 413],
  ])('[BM-011] rejects %s before persistence', async (_name, input, status) => {
    const deps = dependencies();
    const response = await createHouseRequestHandler(deps)(input);

    expect(response.status).toBe(status);
    expect(deps.createHouse).not.toHaveBeenCalled();
  });

  it('[BM-011] maps application validation failures without exposing internals', async () => {
    const deps = dependencies({
      createHouse: vi.fn(async () => {
        throw new DomainError('validation_failed', 'House time zone must be an IANA name');
      }),
    });
    const response = await createHouseRequestHandler(deps)(
      request({ name: 'House', timeZone: 'UTC' }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'validation_failed',
      detail: 'House time zone must be an IANA name',
    });
    expect(deps.logger.log).not.toHaveBeenCalled();
  });
});
