import type { ClosedSeasonView, HouseSeasonView } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SeasonView } from './season-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** Assert the outline opens with the page's only h1, ahead of every h2. */
function expectOutlineLedByH1(html: string): void {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels.indexOf(1)).toBeLessThan(levels.indexOf(2));
}

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
        today="2026-11-04"
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

  it('[BM-034] shows the running table with shared ranks and the viewer marked', () => {
    const row = (membershipId: string, displayName: string, points: number, rank: number) => ({
      membershipId,
      displayName,
      points,
      rank,
      isViewer: displayName === 'Nia',
    });
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={activeSeason}
        standings={[row('m1', 'Max', 4, 1), row('m2', 'Olivia', 4, 1), row('m3', 'Nia', 3, 3)]}
      />,
    );

    expect(html).toContain('<h2 id="season-live-title">Standings</h2>');
    expect(html.match(/aria-label="Rank 1"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Rank 3"');
    expect(html).toMatch(
      /data-viewer="true"><span[^>]*>3<\/span><span class="season-final__name">Nia<span class="season-final__you">You<\/span>/,
    );
    expect(html.indexOf('Standings')).toBeLessThan(html.indexOf('Scheduled Between Moves Nights'));
  });

  it('[BM-034] says nobody has scored before the first points land', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={activeSeason}
      />,
    );

    expect(html).toContain('No points yet. Finish a game to get on the table.');
  });

  it('[BM-034] leaves a closing Season to its frozen standings', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={{ ...activeSeason, state: 'closing' }}
      />,
    );

    expect(html).not.toContain('season-live');
  });

  it('[BM-019] [UX-CMP-09] gives an Owner labeled Charter fields and a read-only points recipe', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={null}
      />,
    );

    expect(html).toContain('<form');
    expect(html).toContain('Season title');
    expect(html).toContain('Correspondence pace');
    expect(html).toContain('Season starts');
    expect(html).toContain('Season ends');
    expect(html).toContain('2 December 2026');
    expect(html).toContain('Between Moves Night');
    expect(html).toContain('Every House scores the same way.');
    expect(html).toContain('Open the Season');
    expect(html).not.toContain('name="completedGame"');
  });

  it('[BM-019] [DR-PERM-01] gives a Member a passive no-Season state', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={null}
      />,
    );

    expect(html).toContain(
      'No Season is running yet. When an Owner or Steward opens one, games and points start.',
    );
    expect(html).not.toContain('<form');
  });

  it('[BM-019] labels a closing Season without presenting it as active', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
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
        today="2026-11-04"
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
        today="2026-11-04"
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
        today="2026-11-04"
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
        today="2026-11-04"
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
        today="2026-11-04"
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
        today="2026-11-04"
        membershipRole="steward"
        nights={nights}
        season={activeSeason}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(html).toContain('Reschedule');
    expect(html).toContain('Cancel Night');
  });

  const lastClosed: ClosedSeasonView = {
    seasonId: '01941f29-7c00-7000-8000-000000000702',
    title: 'Summer tables',
    state: 'closed',
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    endsAt: new Date('2026-08-29T00:00:00.000Z'),
    closedAt: new Date('2026-08-30T09:00:00.000Z'),
    standings: [
      { membershipId: 'a', displayName: 'Ada', points: 7, rank: 1 },
      { membershipId: 'b', displayName: 'Bea', points: 7, rank: 1 },
      { membershipId: 'c', displayName: 'Mira', points: 1, rank: 3 },
      { membershipId: 'd', displayName: 'Lin', points: 0, rank: 4 },
    ],
  };

  it('[BM-047] gives an Owner the close control at the end of an active Season', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={activeSeason}
      />,
    );

    expect(html).toContain('Close the Season');
    expect(html).toContain('Closing freezes the standings');
    expect(html).toContain('>Close Season</button>');
  });

  it('[BM-047] offers a Steward the retry control for a closing Season', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="steward"
        season={{ ...activeSeason, state: 'closing' }}
      />,
    );

    expect(html).toContain('Season closing');
    expect(html).toContain('>Finish closing</button>');
  });

  it('[BM-047] never gives a Member the close control', () => {
    for (const state of ['active', 'closing'] as const) {
      const html = renderToStaticMarkup(
        <SeasonView
          houseId="01941f29-7c00-7000-8000-000000000201"
          today="2026-11-04"
          membershipRole="member"
          season={{ ...activeSeason, state }}
        />,
      );
      expect(html).not.toContain('season-close');
    }
  });

  it('[BM-047] shows a Member the last closed Season with tied competition ranks', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={null}
        lastClosed={lastClosed}
      />,
    );

    expect(html).toContain('Season closed · Final standings');
    expect(html).toContain('Summer tables');
    expect(html).toContain('1 Aug 2026 – 29 Aug 2026 · closed 30 Aug 2026');
    expect(html.match(/aria-label="Rank 1"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Rank 3"');
    expect(html.match(/season-final__row--leader/g)).toHaveLength(2);
    expect(html).toContain('1 point');
    expect(html).toContain('0 points');
  });

  it('[BM-048] opens the Closing Book from the final standings recap', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={null}
        lastClosed={lastClosed}
      />,
    );

    expect(html).toContain(
      '<a class="season-final__book" href="/h/01941f29-7c00-7000-8000-000000000201/closing-book">Read the Closing Book</a>',
    );
  });

  it('[BM-047] shows the frozen standings above a Season left in closing', () => {
    const closing = { ...activeSeason, state: 'closing' as const };
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={closing}
        lastClosed={{
          ...lastClosed,
          seasonId: closing.seasonId,
          title: closing.title,
          state: 'closing',
          closedAt: null,
        }}
      />,
    );

    expect(html).toContain('Season closing · Standings frozen');
    expect(html).not.toContain('· closed');
    expect(html.match(/aria-label="Rank 1"/g)).toHaveLength(2);
    expect(html.indexOf('Standings frozen')).toBeLessThan(html.indexOf('Finish closing'));
  });

  it('[BM-047] ignores a recap that does not belong to the closing Season', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={{ ...activeSeason, state: 'closing' }}
        lastClosed={lastClosed}
      />,
    );

    expect(html).not.toContain('Summer tables');
  });

  it('[BM-047] keeps the recap above a new Charter draft for an Owner', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={null}
        lastClosed={{ ...lastClosed, standings: [] }}
      />,
    );

    expect(html).toContain('No Member scored this Season.');
    expect(html.indexOf('Final standings')).toBeLessThan(html.indexOf('Season title'));
  });

  it('[BM-047] leads a Member no-Season page with its h1 before the recap', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={null}
        lastClosed={lastClosed}
      />,
    );

    expectOutlineLedByH1(html);
    expect(html).toContain('<h1 id="season-passive-title">The table is waiting.</h1>');
    expect(html).toContain('<h2 id="season-final-title">Summer tables</h2>');
  });

  it('[BM-047] leads an Owner draft Charter page with its h1 before the recap', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={{ ...activeSeason, state: 'draft', startsAt: null, endsAt: null }}
        lastClosed={lastClosed}
      />,
    );

    expectOutlineLedByH1(html);
    expect(html).toContain('<h1>Open a Season</h1>');
    expect(html).toContain('<h2 id="season-final-title">Summer tables</h2>');
    expect(html.indexOf('Final standings')).toBeLessThan(html.indexOf('Season title'));
  });

  it('[BM-047] leads a closing Season page with its h1 before the frozen standings', () => {
    const closing = { ...activeSeason, state: 'closing' as const };
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        nights={nights}
        season={closing}
        lastClosed={{
          ...lastClosed,
          seasonId: closing.seasonId,
          title: closing.title,
          state: 'closing',
          closedAt: null,
        }}
      />,
    );

    expectOutlineLedByH1(html);
    expect(html).toContain('<h1 id="season-active-title">Autumn tables</h1>');
    expect(html).toContain('<h2 id="season-final-title">Autumn tables</h2>');
    expect(html.indexOf('Read the Closing Book')).toBeLessThan(html.indexOf('Start Night 1'));
  });

  it('[BM-049] frames an Owner’s Charter after a close as a fresh next Season', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={null}
        lastClosed={lastClosed}
      />,
    );

    expectOutlineLedByH1(html);
    expect(html).toContain('The next Season</p><h1>Open a Season</h1>');
    expect(html).toContain(
      'Nothing carries over from Summer tables: points, standings and awards start again from zero.',
    );
    expect(html).toContain(
      '<input id="charter-title" required="" maxLength="80" name="title" value="November Season"/>',
    );
    expect(html).toContain('Season closed · Final standings');
  });

  it('[BM-049] keeps a House’s first Charter free of renewal wording', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="steward"
        season={null}
      />,
    );

    expect(html).toContain('Four weeks at the table');
    expect(html).not.toContain('The next Season');
    expect(html).not.toContain('Nothing carries over');
  });

  it('[BM-049] tells a Member between Seasons who opens the next one', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={null}
        lastClosed={lastClosed}
      />,
    );

    expect(html).toContain(
      'Summer tables is closed. When an Owner or Steward opens the next Season, points start again from zero.',
    );
    expect(html).not.toContain('No Season is running yet.');
  });

  it.each(['owner', 'member'] as const)(
    '[BM-049] links an %s from a renewed Season back to the last Closing Book',
    (membershipRole) => {
      const html = renderToStaticMarkup(
        <SeasonView
          houseId="01941f29-7c00-7000-8000-000000000201"
          today="2026-11-04"
          membershipRole={membershipRole}
          nights={nights}
          season={activeSeason}
          lastClosed={lastClosed}
        />,
      );

      expect(html).toContain(
        '<p class="season-previous"><span class="season-previous__label">Last Season</span><a href="/h/01941f29-7c00-7000-8000-000000000201/closing-book">Read the Summer tables Closing Book</a></p>',
      );
      expect(html).not.toContain('season-final');
      expect(html).not.toContain('Final standings');
      expect(html.indexOf('season-previous')).toBeLessThan(html.indexOf('Night 1'));
    },
  );

  it('[BM-049] offers no Last Season link before any Season has closed', () => {
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="member"
        season={activeSeason}
      />,
    );

    expect(html).not.toContain('season-previous');
  });

  it('[BM-049] leaves a closing Season’s recap as its only way to the Closing Book', () => {
    const closing = { ...activeSeason, state: 'closing' as const };
    const html = renderToStaticMarkup(
      <SeasonView
        houseId="01941f29-7c00-7000-8000-000000000201"
        today="2026-11-04"
        membershipRole="owner"
        season={closing}
        lastClosed={{
          ...lastClosed,
          seasonId: closing.seasonId,
          title: closing.title,
          state: 'closing',
          closedAt: null,
        }}
      />,
    );

    expect(html).not.toContain('season-previous');
    expect(html.match(/closing-book"/g)).toHaveLength(1);
  });
});
