import { describe, expect, it } from 'vitest';
import { houseLocalDate } from './season-opening';

describe('houseLocalDate', () => {
  it('[BM-019] reads today from the House clock, not the server clock', () => {
    const evening = new Date('2026-11-04T20:00:00.000Z');

    expect(houseLocalDate(evening, 'Asia/Kolkata')).toBe('2026-11-05');
    expect(houseLocalDate(evening, 'America/Los_Angeles')).toBe('2026-11-04');
  });
});
