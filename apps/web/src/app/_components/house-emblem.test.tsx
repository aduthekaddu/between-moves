import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HouseEmblem } from './house-emblem';

describe('HouseEmblem', () => {
  it('[UX-IMG-01] folds the same emblem for the same seed', () => {
    const first = renderToStaticMarkup(<HouseEmblem seed="house:a" label="A emblem" />);
    const again = renderToStaticMarkup(<HouseEmblem seed="house:a" label="A emblem" />);
    expect(first).toBe(again);
  });

  it('folds different emblems for different Houses', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `house:${i}`);
    const shapes = new Set(
      seeds.map((seed) => renderToStaticMarkup(<HouseEmblem seed={seed} label="x" />)),
    );
    expect(shapes.size).toBeGreaterThan(8);
  });

  it('is one named image for assistive technology', () => {
    const html = renderToStaticMarkup(<HouseEmblem seed="house:a" label="Knights emblem" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Knights emblem"');
  });
});
