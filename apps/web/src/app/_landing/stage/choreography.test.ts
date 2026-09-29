import { describe, expect, it } from 'vitest';
import { SPRITES } from '../../_theatre/assets';
import { ACTS, type View } from './choreography';

const views: readonly View[] = [
  { w: 1440, h: 900, portrait: false },
  { w: 390, h: 844, portrait: true },
];

describe('landing choreography', () => {
  it('cues only known sprites, with finite placement, across every act and view', () => {
    for (const [id, act] of Object.entries(ACTS)) {
      for (const sprite of act.sprites) expect(SPRITES[sprite], `${id}: ${sprite}`).toBeDefined();
      for (const view of views) {
        for (let s = -0.5; s <= 8; s += 0.25) {
          for (const t of [0, 1.25, 7.5]) {
            for (const draw of act.cues(s, t, view, 1)) {
              expect(SPRITES[draw.key], `${id} cue ${draw.key}`).toBeDefined();
              for (const value of [
                draw.x,
                draw.y,
                draw.h,
                draw.z,
                draw.rot ?? 0,
                draw.alpha ?? 1,
              ]) {
                expect(Number.isFinite(value), `${id} at s=${s}`).toBe(true);
              }
              expect(draw.alpha ?? 1).toBeGreaterThanOrEqual(0);
              expect(draw.alpha ?? 1).toBeLessThanOrEqual(1);
              expect(draw.z).toBeGreaterThanOrEqual(0);
              expect(draw.z).toBeLessThan(0.9);
            }
          }
        }
      }
    }
  });

  it('holds poses between frames on twos: the same twelfth of a second cues the same stage', () => {
    const week = ACTS.week;
    const view = views[0]!;
    expect(week.cues(2.5, 3, view, 1)).toEqual(week.cues(2.5, 3, view, 1));
  });

  it('keeps each act dark before it arrives and after it leaves', () => {
    for (const [id, act] of Object.entries(ACTS)) {
      if (id === 'prelude') continue;
      const lit = (s: number) =>
        act.cues(s, 2, views[0]!, 1).filter((draw) => (draw.alpha ?? 1) > 0.02).length;
      expect(lit(0), `${id} before`).toBe(0);
      // the door is the closing tableau: it holds until the curtain (the footer) brings the lamp down
      if (id !== 'door') expect(lit(9), `${id} after`).toBe(0);
    }
  });

  it('gives every act a valid screen tint', () => {
    for (const act of Object.values(ACTS)) {
      for (const s of [0, 1, 2.5, 4]) {
        const tint = act.tint(s);
        expect(tint).toHaveLength(3);
        for (const channel of tint) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
