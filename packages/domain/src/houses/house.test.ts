import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/errors';
import { createHouseEmblemSeed, createHouseSlug, validateCreateHouseCommand } from './house';

const houseId = '01941f29-7c00-7000-8000-000000000201';

describe('House creation rules', () => {
  it('[BM-011] [DR-HOUSE-01] validates and normalizes a House creation command', () => {
    expect(
      validateCreateHouseCommand({
        name: '  Knights at Dusk  ',
        description: '  Friends playing every week.  ',
        timeZone: 'Asia/Kolkata',
      }),
    ).toEqual({
      name: 'Knights at Dusk',
      description: 'Friends playing every week.',
      timeZone: 'Asia/Calcutta',
    });

    expect(
      validateCreateHouseCommand({ name: 'Maple House', timeZone: 'America/Toronto' }),
    ).toEqual({ name: 'Maple House', description: null, timeZone: 'America/Toronto' });
  });

  it.each([
    [{ name: '   ', timeZone: 'UTC' }, 'name'],
    [{ name: 'x'.repeat(81), timeZone: 'UTC' }, 'name'],
    [{ name: 'House', description: 'x'.repeat(501), timeZone: 'UTC' }, 'description'],
    [{ name: 'House', timeZone: '+05:30' }, 'time zone'],
    [{ name: 'House', timeZone: 'Mars/Olympus_Mons' }, 'time zone'],
  ])('[BM-011] rejects an invalid create command: %s', (command, field) => {
    expect(() => validateCreateHouseCommand(command)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'validation_failed',
        message: expect.stringContaining(field),
      }),
    );
  });

  it('[BM-011] [UX-IMG-01] derives stable opaque slug and emblem values from server identity', () => {
    expect(createHouseSlug(houseId)).toBe(houseId);
    expect(createHouseEmblemSeed(houseId)).toBe(`house:${houseId}`);
  });
});
