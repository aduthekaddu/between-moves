import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptGameSeatCommandHandler,
  type GameSeatAcceptanceHandlerDependencies,
} from './game-seat-acceptance-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(overrides: Record<string, string> = {}): Request {
  return new Request(`https://app.example.test/api/houses/${houseId}/games/${gameId}/accept`, {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'x-request-id': 'bm-023-request',
      ...overrides,
    },
  });
}

function dependencies(
  overrides: Partial<GameSeatAcceptanceHandlerDependencies> = {},
): GameSeatAcceptanceHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    acceptGameSeat: vi.fn(async () => ({
      gameId,
      houseId,
      whiteMembershipId: '01941f29-7c00-7000-8000-000000000501',
      blackMembershipId: '01941f29-7c00-7000-8000-000000000502',
      moveDueAt: new Date('2026-09-04T08:00:00.000Z'),
      state: 'active' as const,
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: { now: vi.fn(() => new Date('2026-09-02T08:00:00.000Z')) },
    ...overrides,
  };
}

describe('BM-023 Game seat acceptance HTTP boundary', () => {
  it('[BM-023] activates the Game and logs game.activated without Member details', async () => {
    const deps = dependencies();

    const response = await acceptGameSeatCommandHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ gameId, state: 'active' });
    expect(deps.acceptGameSeat).toHaveBeenCalledWith({ houseId, gameId, viewer });
    expect(deps.logger.log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'bm-023-request',
      actorId: viewer.userId,
      houseId,
      gameId,
      commandId: null,
      event: 'game.activated',
      outcome: 'success',
      durationMs: 0,
      data: {},
    });
  });

  it('[BM-023] maps direct-challenge denial, a lost race, and unavailable seats', async () => {
    const forbidden = dependencies({
      acceptGameSeat: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('role_not_permitted', false);
      }),
    });
    const taken = dependencies({
      acceptGameSeat: vi.fn(async () => {
        throw new DomainError('conflict', 'Open seat is already taken');
      }),
    });
    const unavailable = dependencies({
      acceptGameSeat: vi.fn(async () => {
        throw new DomainError('not_found', 'Open seat is unavailable');
      }),
    });

    const forbiddenResponse = await acceptGameSeatCommandHandler(forbidden)(
      request(),
      houseId,
      gameId,
    );
    const takenResponse = await acceptGameSeatCommandHandler(taken)(request(), houseId, gameId);
    const unavailableResponse = await acceptGameSeatCommandHandler(unavailable)(
      request(),
      houseId,
      gameId,
    );

    expect(forbiddenResponse.status).toBe(403);
    expect(takenResponse.status).toBe(409);
    await expect(takenResponse.json()).resolves.toMatchObject({ code: 'seat_taken' });
    expect(unavailableResponse.status).toBe(404);
  });

  it('[BM-023] rejects invalid routes, origins, and anonymous requests', async () => {
    const deps = dependencies();
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });

    const invalidHouse = await acceptGameSeatCommandHandler(deps)(request(), 'not-a-house', gameId);
    const invalidGame = await acceptGameSeatCommandHandler(deps)(request(), houseId, 'not-a-game');
    const invalidOrigin = await acceptGameSeatCommandHandler(deps)(
      request({ origin: 'https://evil.example.test' }),
      houseId,
      gameId,
    );
    const anonymousResponse = await acceptGameSeatCommandHandler(anonymous)(
      request(),
      houseId,
      gameId,
    );

    expect(invalidHouse.status).toBe(422);
    expect(invalidGame.status).toBe(422);
    expect(invalidOrigin.status).toBe(403);
    expect(anonymousResponse.status).toBe(401);
    expect(deps.acceptGameSeat).not.toHaveBeenCalled();
  });
});
