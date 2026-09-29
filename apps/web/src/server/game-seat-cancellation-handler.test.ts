import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  DomainError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { cancelGameSeatCommandHandler } from './game-seat-cancellation-handler';

const origin = 'https://betweenmoves.test';
const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000501';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function dependencies(cancelGameSeat = vi.fn()) {
  return {
    expectedOrigin: origin,
    requireViewer: vi.fn(async () => viewer),
    cancelGameSeat,
    logger: { log: vi.fn() },
    clock: { now: () => new Date('2026-09-02T10:00:00.000Z') },
  };
}

function request(headers: Record<string, string> = { origin }) {
  return new Request(`${origin}/api/houses/${houseId}/games/${gameId}/cancel`, {
    method: 'POST',
    headers,
  });
}

describe('POST /api/houses/{houseId}/games/{gameId}/cancel', () => {
  it('[BM-022] cancels the seat and logs who cancelled it', async () => {
    const deps = dependencies(
      vi.fn(async () => ({
        gameId,
        houseId,
        cancelledBy: 'challenged' as const,
        state: 'cancelled' as const,
        cancelledNow: true,
      })),
    );

    const response = await cancelGameSeatCommandHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      gameId,
      state: 'cancelled',
      cancelledBy: 'challenged',
    });
    expect(deps.cancelGameSeat).toHaveBeenCalledWith({ houseId, gameId, viewer });
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'seat.cancelled', data: { cancelled_by: 'challenged' } }),
    );
  });

  it('[BM-051] rejects a foreign origin, a bad route and a signed-out visitor first', async () => {
    const deps = dependencies();
    const handler = cancelGameSeatCommandHandler(deps);

    expect((await handler(request({ origin: 'https://evil.test' }), houseId, gameId)).status).toBe(
      403,
    );
    expect((await handler(request(), houseId, 'not-a-game')).status).toBe(422);
    deps.requireViewer.mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await handler(request(), houseId, gameId)).status).toBe(401);
    expect(deps.cancelGameSeat).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthorizationDeniedError('Only the creator'), 403, 'forbidden'],
    [new DomainError('conflict', 'Open seat is already taken'), 409, 'seat_taken'],
    [new DomainError('not_found', 'Open seat is unavailable'), 404, 'not_found'],
  ])('[BM-022] maps %s to %i', async (error, status, code) => {
    const response = await cancelGameSeatCommandHandler(
      dependencies(
        vi.fn(async () => {
          throw error;
        }),
      ),
    )(request(), houseId, gameId);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });
});
