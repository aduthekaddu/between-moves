import { HouseAuthorizationDeniedError, type MoveShelf } from '@between-moves/domain';
import { createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createMoveShelfReader } from './move-shelf';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const viewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
} as const;
const shelf: MoveShelf = { yourMove: [], waiting: [], recent: [] };

function request(): Request {
  return new Request(`https://betweenmoves.test/h/${houseId}`, {
    headers: { 'x-request-id': 'bm-026-shelf-view' },
  });
}

describe('Move Shelf request seam', () => {
  it('[BM-026] logs a successful, PII-free shelf view', async () => {
    const lines: string[] = [];
    const readMoveShelf = vi.fn(async () => shelf);
    const reader = createMoveShelfReader({
      getViewer: vi.fn(async () => viewer),
      readMoveShelf,
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-09-07T00:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
      clock: { now: () => new Date('2026-09-07T00:00:00.000Z') },
    });

    await expect(reader(request(), houseId)).resolves.toEqual(shelf);
    expect(readMoveShelf).toHaveBeenCalledWith({ houseId, viewer });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      request_id: 'bm-026-shelf-view',
      actor_id: viewer.userId,
      house_id: houseId,
      game_id: null,
      event: 'game.move-shelf-viewed',
      outcome: 'success',
    });
    expect(lines[0]).not.toContain(viewer.displayName);
  });

  it('[BM-026] hides authorization denials without logging a shelf view', async () => {
    const logger = { log: vi.fn() };
    const reader = createMoveShelfReader({
      getViewer: vi.fn(async () => viewer),
      readMoveShelf: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
      logger,
      clock: { now: () => new Date('2026-09-07T00:00:00.000Z') },
    });

    await expect(reader(request(), houseId)).resolves.toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
