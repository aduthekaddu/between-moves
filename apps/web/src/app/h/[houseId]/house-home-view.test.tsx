import type { HouseHome } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HouseHomeView } from './house-home-view';

const home: HouseHome = {
  houseId: '01941f29-7c00-7000-8000-000000000601',
  name: 'Knights at Dusk',
  description: 'Friendly games every week.',
  emblemSeed: 'house:01941f29-7c00-7000-8000-000000000601',
  timeZone: 'Asia/Kolkata',
  membershipRole: 'owner',
};

describe('House home view', () => {
  it('[BM-013] [UX-IA-01] renders the member-visible House details', () => {
    const html = renderToStaticMarkup(<HouseHomeView home={home} />);

    expect(html).toContain('<h1');
    expect(html).toContain('Knights at Dusk');
    expect(html).toContain('Friendly games every week.');
    expect(html).toContain('Asia/Kolkata');
    expect(html).toContain('Owner');
  });

  it('[BM-013] [UX-IMG-01] gives the deterministic emblem the House name', () => {
    const html = renderToStaticMarkup(<HouseHomeView home={home} />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Knights at Dusk emblem"');
  });

  it('[BM-013] [PR-DEF-02] gives a House without a description an on-voice prompt', () => {
    const html = renderToStaticMarkup(<HouseHomeView home={{ ...home, description: null }} />);

    expect(html).toContain('A quiet table, ready for the first game.');
  });
});
