import type { HouseSeasonView } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeasonView } from './season-view';

const activeSeason: HouseSeasonView = {
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  title: 'Autumn tables',
  state: 'active',
  startsAt: new Date('2026-09-04T00:00:00.000Z'),
  endsAt: new Date('2026-10-02T00:00:00.000Z'),
  charter: {
    version: 2,
    correspondencePaceHours: 24,
    nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
    pointsRecipe: {
      completedGame: 1,
      win: 2,
      draw: 1,
      nightAttendance: 1,
      publishedPuzzle: 1,
      caps: { games: 8, nights: 4, puzzles: 2 },
    },
  },
};

describe('SeasonView', () => {
  it('[BM-019] [PR-JRN-03] shows the active Season and published Charter version', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="owner"
        season={activeSeason}
      />,
    );

    expect(html).toContain('Season active');
    expect(html).toContain('Autumn tables');
    expect(html).toContain('Charter version 2');
    expect(html).toContain('24 hours per Move');
    expect(html).toContain('Friday');
  });

  it('[BM-019] [UX-CMP-09] gives an Owner labeled Charter fields and a read-only points recipe', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="owner"
        season={null}
      />,
    );

    expect(html).toContain('<form');
    expect(html).toContain('Season title');
    expect(html).toContain('Correspondence pace');
    expect(html).toContain('Season starts');
    expect(html).toContain('Season ends');
    expect(html).toContain('Between Moves Night');
    expect(html).toContain('The MVP points recipe is fixed');
    expect(html).toContain('Publish Charter');
    expect(html).not.toContain('name="completedGame"');
  });

  it('[BM-019] [DR-PERM-01] gives a Member a passive no-Season state', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="member"
        season={null}
      />,
    );

    expect(html).toContain('Your House is quiet. Publish a Charter to start the season.');
    expect(html).not.toContain('<form');
  });

  it('[BM-019] labels a closing Season without presenting it as active', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="member"
        season={{ ...activeSeason, state: 'closing' }}
      />,
    );

    expect(html).toContain('Season closing');
    expect(html).not.toContain('Season active');
  });
});
