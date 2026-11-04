import { describe, expect, it } from 'vitest';
import { rivalryLine } from './rivalry';

const names = { white: 'Ben', black: 'Asha' };

describe('rivalry line', () => {
  it('tells a player where they stand against this opponent', () => {
    const record = { whiteWins: 2, blackWins: 1, draws: 1 };
    expect(rivalryLine({ ...names, headToHead: record, viewer: 'white' })).toBe(
      'You lead Asha 2–1 · 1 draw',
    );
    expect(rivalryLine({ ...names, headToHead: record, viewer: 'black' })).toBe(
      'Ben leads 2–1 · 1 draw',
    );
    expect(
      rivalryLine({
        ...names,
        headToHead: { whiteWins: 1, blackWins: 1, draws: 0 },
        viewer: 'black',
      }),
    ).toBe('Level with Ben at 1–1');
  });

  it('marks a first meeting', () => {
    const none = { whiteWins: 0, blackWins: 0, draws: 0 };
    expect(rivalryLine({ ...names, headToHead: none, viewer: 'black' })).toBe(
      'Your first game against Ben',
    );
    expect(rivalryLine({ ...names, headToHead: none, viewer: null })).toBe(
      'Their first game against each other',
    );
  });

  it('gives a spectator the plain score', () => {
    expect(
      rivalryLine({ ...names, headToHead: { whiteWins: 3, blackWins: 0, draws: 2 }, viewer: null }),
    ).toBe('Ben 3–0 Asha · 2 draws');
  });
});
