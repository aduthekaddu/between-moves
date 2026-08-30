import { HouseAuthorizationDeniedError, type HouseHome } from '@between-moves/domain';
import { createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createHouseHomeReader } from './house-home';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const viewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
} as const;
const home: HouseHome = {
  houseId,
  name: 'Knights at Dusk',
  description: 'Friendly games every week.',
  emblemSeed: `house:${houseId}`,
  timeZone: 'Asia/Kolkata',
  membershipRole: 'owner',
};

function request(): Request {
  return new Request(`https://betweenmoves.test/h/${houseId}`, {
    headers: { 'x-request-id': 'bm-013-house-view' },
  });
}

describe('House home request seam', () => {
  it('[BM-013] [DR-MEM-04] returns the member-scoped House and logs the view', async () => {
    const lines: string[] = [];
    const readHouseHome = vi.fn(async () => home);
    const reader = createHouseHomeReader({
      getViewer: vi.fn(async () => viewer),
      readHouseHome,
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-08-30T00:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
      clock: { now: () => new Date('2026-08-30T00:00:00.000Z') },
    });

    await expect(reader(request(), houseId)).resolves.toEqual(home);
    expect(readHouseHome).toHaveBeenCalledWith({ houseId, viewer });
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      request_id: 'bm-013-house-view',
      actor_id: viewer.userId,
      house_id: houseId,
      event: 'house.home-viewed',
      outcome: 'success',
    });
  });

  it('[BM-013] hides a cross-House authorization denial behind the not-found page result', async () => {
    const logger = { log: vi.fn() };
    const reader = createHouseHomeReader({
      getViewer: vi.fn(async () => viewer),
      readHouseHome: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
      logger,
      clock: { now: () => new Date('2026-08-30T00:00:00.000Z') },
    });

    await expect(reader(request(), houseId)).resolves.toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
