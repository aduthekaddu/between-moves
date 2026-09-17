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
  const nights = [0, 1, 2, 3].map((week) => ({
    nightId: `01941f29-7c00-7000-8000-00000000090${week + 1}`,
    houseId: '01941f29-7c00-7000-8000-000000000201',
    seasonId: activeSeason.seasonId,
    scheduledStart: new Date(Date.UTC(2026, 8, 4 + week * 7, 14)),
    scheduledEnd: new Date(Date.UTC(2026, 8, 4 + week * 7, 16)),
    state: 'scheduled' as const,
    hostMembershipId: null,
    startedAt: null,
    endedAt: null,
    viewerIsHost: false,
    viewerRsvp: null,
  }));

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

  it('[BM-020] lists four scheduled Nights and exposes Owner edit controls', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="owner"
        nights={nights}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Scheduled Between Moves Nights');
    expect(html.match(/<h3>Night [1-4]<\/h3>/g)).toHaveLength(4);
    expect(html).toContain('4 Sept 2026, 19:30');
    expect(html).toContain('Reschedule');
    expect(html).toContain('Cancel Night');
  });

  it('[BM-020] gives a Member the scheduled list without edit controls', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="member"
        nights={nights}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html.match(/<h3>Night [1-4]<\/h3>/g)).toHaveLength(4);
    expect(html).not.toContain('Reschedule');
    expect(html).not.toContain('Cancel Night');
  });

  it('[BM-035] lets an Owner assign a host and start a Night', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="owner"
        nights={nights}
        hostCandidates={[
          {
            membershipId: '01941f29-7c00-7000-8000-000000000623',
            displayName: 'Bea',
          },
        ]}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Start Night 1');
    expect(html).toContain('Assign Night host');
    expect(html).toContain('Going');
    expect(html).toContain('Bea');
  });

  it('[BM-035] hides start/end from a Member without host duty', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="member"
        nights={nights}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Going');
    expect(html).not.toContain('Start Night 1');
    expect(html).not.toContain('Assign Night host');
  });

  it('[BM-035] lets an assigned host start and end their Night', () => {
    const hosted = nights.map((night, index) =>
      index === 0
        ? {
            ...night,
            viewerIsHost: true,
            hostMembershipId: '01941f29-7c00-7000-8000-000000000623',
          }
        : night,
    );
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="member"
        nights={hosted}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Start Night 1');
    expect(html).not.toContain('Start Night 2');
    expect(html).not.toContain('Assign Night host');
  });

  it('[BM-020] exposes the same Night edit controls to a Steward', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        membershipRole="steward"
        nights={nights}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Reschedule');
    expect(html).toContain('Cancel Night');
  });
});
