import type { GamePosition } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createGamePositionResponse } from './route';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const gameId = '01941f29-7c00-7000-8000-000000000701';
const url = `https://betweenmoves.test/api/houses/${houseId}/games/${gameId}`;
const position: GamePosition = {
  gameId,
  mode: 'correspondence',
  state: 'active',
  currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 7,
  white: { membershipId: '01941f29-7c00-7000-8000-000000000801', name: 'Ada' },
  black: { membershipId: '01941f29-7c00-7000-8000-000000000802', name: 'Bea' },
  viewerColor: 'white',
  canMove: true,
  moveDueAt: new Date('2026-09-10T08:00:00.000Z'),
  result: null,
  resultReason: null,
  inCheck: false,
  moves: [],
  pendingDrawOffer: null,
  drawOfferDeclined: false,
  headToHead: { whiteWins: 0, blackWins: 0, draws: 0 },
};

describe('GET /api/houses/{houseId}/games/{gameId}', () => {
  it('[BM-027] returns the canonical Game with a version ETag', async () => {
    const readPosition = vi.fn(async () => position);
    const request = new Request(url);
    const response = await createGamePositionResponse(request, houseId, gameId, readPosition);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('etag')).toBe('"7"');
    await expect(response.json()).resolves.toMatchObject({
      gameId,
      version: 7,
      moveDueAt: '2026-09-10T08:00:00.000Z',
    });
  });

  it('[BM-027] returns 304 when the authorized version is unchanged', async () => {
    const readPosition = vi.fn(async () => position);
    const request = new Request(url, { headers: { 'If-None-Match': 'W/"7"' } });
    const response = await createGamePositionResponse(request, houseId, gameId, readPosition);

    expect(readPosition).toHaveBeenCalledWith(request, houseId, gameId);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"7"');
    expect(await response.text()).toBe('');
  });

  it('[BM-028] changes the ETag when a draw is offered or declined at the same version', async () => {
    const offered = {
      ...position,
      pendingDrawOffer: { offeringMembershipId: position.black.membershipId, ply: 0 },
    };
    const response = await createGamePositionResponse(
      new Request(url, { headers: { 'If-None-Match': '"7"' } }),
      houseId,
      gameId,
      vi.fn(async () => offered),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"7-d0"');
    await expect(response.json()).resolves.toMatchObject({
      pendingDrawOffer: { offeringMembershipId: position.black.membershipId, ply: 0 },
    });

    const declined = await createGamePositionResponse(
      new Request(url, { headers: { 'If-None-Match': '"7-d0"' } }),
      houseId,
      gameId,
      vi.fn(async () => ({ ...position, drawOfferDeclined: true })),
    );
    expect(declined.status).toBe(200);
    expect(declined.headers.get('etag')).toBe('"7-x"');
  });

  it('[BM-041] returns the durable live clock snapshot', async () => {
    const live = {
      ...position,
      mode: 'live' as const,
      moveDueAt: null,
      liveClock: {
        whiteMs: 292_000,
        blackMs: 300_000,
        turnStartedAt: new Date('2026-09-02T09:00:10.000Z'),
      },
    };
    const response = await createGamePositionResponse(
      new Request(url, { headers: { 'If-None-Match': '"7"' } }),
      houseId,
      gameId,
      vi.fn(async () => live),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      serverNow: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      liveClock: {
        whiteMs: 292_000,
        blackMs: 300_000,
        turnStartedAt: '2026-09-02T09:00:10.000Z',
      },
    });
  });

  it('[BM-027] returns one neutral problem for an unavailable Game', async () => {
    const response = await createGamePositionResponse(
      new Request(url),
      houseId,
      gameId,
      vi.fn(async () => null),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({
      code: 'not_found',
      detail: 'The Game is unavailable.',
    });
  });
});
