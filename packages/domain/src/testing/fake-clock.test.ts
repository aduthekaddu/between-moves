import { describe, expect, it } from 'vitest';
import type { Clock } from '../shared/clock';
import { FakeClock } from './fake-clock';

function observedTime(clock: Clock): string {
  return clock.now().toISOString();
}

describe('FakeClock', () => {
  it('[BM-005] advances injected time deterministically without sleeping', () => {
    const clock = new FakeClock(new Date('2026-08-29T00:00:00.000Z'));

    expect(observedTime(clock)).toBe('2026-08-29T00:00:00.000Z');

    clock.advance(90_000);

    expect(observedTime(clock)).toBe('2026-08-29T00:01:30.000Z');
  });

  it('[BM-005] rejects invalid clock advances without changing observed time', () => {
    const clock = new FakeClock(new Date('2026-08-29T00:00:00.000Z'));

    expect(() => clock.advance(-1)).toThrow('Clock advance must be a finite non-negative number');
    expect(observedTime(clock)).toBe('2026-08-29T00:00:00.000Z');
  });
});
