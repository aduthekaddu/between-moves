import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock';

// Advancing time is exercised by every integration test that uses FakeClock.
// Only this file passes a bad advance.
describe('FakeClock', () => {
  it('[BM-005] rejects invalid clock advances without changing observed time', () => {
    const clock = new FakeClock(new Date('2026-08-29T00:00:00.000Z'));

    expect(() => clock.advance(-1)).toThrow('Clock advance must be a finite non-negative number');
    expect(clock.now().toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });
});
