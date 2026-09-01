import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createGameSeatCommandHandler } from './game-seat-command-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const intendedMembershipId = '01941f29-7c00-7000-8000-000000000202';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.example.test/api/houses/${houseId}/games`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.test',
      'x-request-id': 'bm-022-request',
      'idempotency-key': 'seat-command-1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    createGameSeat: vi.fn(async (command) => ({
      gameId: '01941f29-7c00-7000-8000-000000000301',
      openSeatId: '01941f29-7c00-7000-8000-000000000302',
      houseId: command.houseId,
      seasonId: '01941f29-7c00-7000-8000-000000000401',
      creatorMembershipId: '01941f29-7c00-7000-8000-000000000501',
      intendedMembershipId: command.intendedMembershipId,
      offeredColor: command.offeredColor,
      creatorColor: 'black' as const,
      expiresAt: new Date('2026-09-09T08:00:00.000Z'),
      state: 'waiting' as const,
      createdNow: true,
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: { now: vi.fn(() => new Date('2026-09-02T08:00:00.000Z')) },
    ...overrides,
  };
}

const body = {
  mode: 'correspondence',
  clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
  offeredColor: 'any',
  intendedMembershipId,
};

describe('BM-022 Game seat HTTP boundary', () => {
  it('creates a direct challenge and logs seat.created without Member details', async () => {
    const deps = dependencies();
    const response = await createGameSeatCommandHandler(deps)(request(body), houseId);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      gameId: '01941f29-7c00-7000-8000-000000000301',
      openSeatId: '01941f29-7c00-7000-8000-000000000302',
    });
    expect(deps.createGameSeat).toHaveBeenCalledWith({
      houseId,
      ...body,
      intendedMembershipId,
      idempotencyKey: 'seat-command-1',
      viewer,
    });
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'bm-022-request',
      actorId: viewer.userId,
      houseId,
      gameId: '01941f29-7c00-7000-8000-000000000301',
      commandId: 'seat-command-1',
      event: 'seat.created',
      outcome: 'success',
      durationMs: 0,
      data: {
        open_seat_id: '01941f29-7c00-7000-8000-000000000302',
        offered_color: 'any',
        direct: true,
      },
    });
  });

  it('denies non-members and maps command conflicts', async () => {
    const forbidden = dependencies({
      createGameSeat: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    const conflict = dependencies({
      createGameSeat: vi.fn(async () => {
        throw new DomainError('idempotency_conflict', 'key reused');
      }),
    });

    expect((await createGameSeatCommandHandler(forbidden)(request(body), houseId)).status).toBe(
      403,
    );
    const conflictResponse = await createGameSeatCommandHandler(conflict)(request(body), houseId);
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('rejects invalid bodies, routes, origins, idempotency keys, and anonymous requests', async () => {
    const deps = dependencies();
    const invalidBody = await createGameSeatCommandHandler(deps)(
      request({ ...body, mode: 'live' }),
      houseId,
    );
    const invalidRoute = await createGameSeatCommandHandler(deps)(request(body), 'not-a-house');
    const invalidOrigin = await createGameSeatCommandHandler(deps)(
      request(body, { origin: 'https://evil.example.test' }),
      houseId,
    );
    const invalidKey = await createGameSeatCommandHandler(deps)(
      request(body, { 'idempotency-key': ' '.repeat(2) }),
      houseId,
    );
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const anonymousResponse = await createGameSeatCommandHandler(anonymous)(request(body), houseId);

    expect(invalidBody.status).toBe(422);
    expect(invalidRoute.status).toBe(422);
    expect(invalidOrigin.status).toBe(403);
    expect(invalidKey.status).toBe(422);
    expect(anonymousResponse.status).toBe(401);
    expect(deps.createGameSeat).not.toHaveBeenCalled();
  });
});
