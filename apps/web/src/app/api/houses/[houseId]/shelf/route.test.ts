import type { MoveShelf } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createMoveShelfResponse } from './route';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const request = new Request(`https://betweenmoves.test/api/houses/${houseId}/shelf`);
const shelf: MoveShelf = {
  yourMove: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000701',
      opponentName: 'Bea',
      moveDueAt: new Date('2026-09-08T09:00:00.000Z'),
      ply: 14,
    },
  ],
  waiting: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000702',
      opponentName: 'Grace',
      moveDueAt: new Date('2026-09-09T09:00:00.000Z'),
    },
  ],
  recent: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000703',
      opponentName: 'Lin',
      result: 'draw',
      completedAt: new Date('2026-09-06T09:00:00.000Z'),
    },
  ],
};

describe('GET /api/houses/{houseId}/shelf', () => {
  it('[BM-026] [DR-SHELF-01] serializes ordered groups with private cache controls', async () => {
    const readShelf = vi.fn(async () => shelf);
    const response = await createMoveShelfResponse(request, houseId, readShelf);

    expect(readShelf).toHaveBeenCalledWith(request, houseId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      yourMove: [
        {
          gameId: shelf.yourMove[0]?.gameId,
          opponent: 'Bea',
          moveDueAt: '2026-09-08T09:00:00.000Z',
          ply: 14,
        },
      ],
      waiting: [
        {
          gameId: shelf.waiting[0]?.gameId,
          opponent: 'Grace',
          moveDueAt: '2026-09-09T09:00:00.000Z',
        },
      ],
      recent: [
        {
          gameId: shelf.recent[0]?.gameId,
          result: 'draw',
          completedAt: '2026-09-06T09:00:00.000Z',
        },
      ],
    });
  });

  it('[BM-026] [DR-SEC-01] returns one neutral problem for an unavailable House', async () => {
    const response = await createMoveShelfResponse(
      request,
      houseId,
      vi.fn(async () => null),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({
      code: 'not_found',
      detail: 'This House is not available.',
      instance: `/api/houses/${houseId}/shelf`,
    });
  });

  it('[BM-026] [DR-SEC-03] rejects an invalid House ID before the shelf read', async () => {
    const readShelf = vi.fn(async () => shelf);
    const response = await createMoveShelfResponse(request, 'not-a-house-id', readShelf);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validation_failed',
      detail: 'House ID is invalid.',
    });
    expect(readShelf).not.toHaveBeenCalled();
  });
});
