import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { advanceLiveClock, validateLiveClockPolicy } from './live-clock';

describe('BM-041 live clock', () => {
  const started = new Date('2026-09-02T09:00:00.000Z');

  it('decrements the mover, awards increment for a completed move, and starts the next turn', () => {
    expect(
      advanceLiveClock(
        { whiteMs: 300_000, blackMs: 300_000, turnStartedAt: started },
        'white',
        new Date(started.getTime() + 5_000),
        2_000,
        true,
      ),
    ).toEqual({
      whiteMs: 297_000,
      blackMs: 300_000,
      turnStartedAt: new Date(started.getTime() + 5_000),
      flagged: false,
    });
  });

  it('starts the next turn after server processing without charging that delay', () => {
    expect(
      advanceLiveClock(
        { whiteMs: 300_000, blackMs: 300_000, turnStartedAt: started },
        'white',
        new Date(started.getTime() + 10_000),
        2_000,
        true,
        new Date(started.getTime() + 20_000),
      ),
    ).toMatchObject({
      whiteMs: 292_000,
      blackMs: 300_000,
      turnStartedAt: new Date(started.getTime() + 20_000),
    });
  });

  it('rejects controls shorter than three minutes', () => {
    expect(() =>
      validateLiveClockPolicy({ kind: 'live', initialMs: 179_999, incrementMs: 0 }),
    ).toThrow('Live clock control is invalid');
    expect(() =>
      validateLiveClockPolicy({ kind: 'live', initialMs: 180_000, incrementMs: 0 }),
    ).not.toThrow();
  });

  it('keeps remaining time nonnegative and never awards increment without a completed move', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_147_483_647 }),
        fc.integer({ min: 0, max: 2_147_483_647 }),
        fc.integer({ min: 0, max: 4_294_967_294 }),
        fc.integer({ min: 0, max: 2_147_483_647 }),
        fc.constantFrom('white' as const, 'black' as const),
        fc.boolean(),
        (whiteMs, blackMs, elapsed, incrementMs, side, completedMove) => {
          const next = advanceLiveClock(
            { whiteMs, blackMs, turnStartedAt: started },
            side,
            new Date(started.getTime() + elapsed),
            incrementMs,
            completedMove,
          );
          const remaining = side === 'white' ? whiteMs : blackMs;
          const spent = Math.max(0, remaining - elapsed);
          const moving = side === 'white' ? next.whiteMs : next.blackMs;
          const other = side === 'white' ? next.blackMs : next.whiteMs;
          expect(moving).toBe(
            completedMove && spent > 0 ? Math.min(2_147_483_647, spent + incrementMs) : spent,
          );
          expect(other).toBe(side === 'white' ? blackMs : whiteMs);
          expect(next.whiteMs).toBeGreaterThanOrEqual(0);
          expect(next.blackMs).toBeGreaterThanOrEqual(0);
          expect(next.flagged).toBe(spent === 0);
        },
      ),
    );
  });
});
