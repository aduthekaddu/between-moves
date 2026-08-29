import type { AuthenticatedViewer, HouseCreationInput } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createHouse } from './create-house';

const ids = [
  '01941f29-7c00-7000-8000-000000000201',
  '01941f29-7c00-7000-8000-000000000202',
  '01941f29-7c00-7000-8000-000000000203',
];
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

describe('createHouse', () => {
  it('[BM-011] [DR-HOUSE-01] creates the House and Owner records from server authority', async () => {
    const create = vi.fn(async (input: HouseCreationInput) => ({
      houseId: input.houseId,
      ownerMembershipId: input.ownerMembershipId,
      slug: input.slug,
      emblemSeed: input.emblemSeed,
      timeZone: input.timeZone,
    }));
    let idIndex = 0;

    const result = await createHouse(
      { name: '  Knights at Dusk ', description: ' Weekly games ', timeZone: 'Asia/Kolkata' },
      viewer,
      {
        clock: { now: () => new Date('2026-08-30T00:00:00.000Z') },
        ids: { generate: () => ids[idIndex++]! },
        houses: { create },
      },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      houseId: ids[0],
      ownerMembershipId: ids[1],
      auditId: ids[2],
      ownerUserId: viewer.userId,
      name: 'Knights at Dusk',
      description: 'Weekly games',
      timeZone: 'Asia/Calcutta',
      slug: ids[0],
      emblemSeed: `house:${ids[0]}`,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    expect(result).toEqual({
      houseId: ids[0],
      ownerMembershipId: ids[1],
      slug: ids[0],
      emblemSeed: `house:${ids[0]}`,
      timeZone: 'Asia/Calcutta',
    });
  });

  it('[BM-011] validates before allocating IDs or opening persistence work', async () => {
    const generate = vi.fn();
    const create = vi.fn();

    await expect(
      createHouse({ name: '', timeZone: 'UTC' }, viewer, {
        clock: { now: () => new Date() },
        ids: { generate },
        houses: { create },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    expect(generate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
