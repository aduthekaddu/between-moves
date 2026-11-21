import type {
  HouseHome,
  HouseRoster,
  HouseRosterMember,
  HouseSeasonView,
  MoveShelf,
  OpenSeatListing,
} from '@between-moves/domain';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { standingRows } from '../../../modules/seasons/standing-rows';
import { HouseHomeView } from './house-home-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const houseId = '01941f29-7c00-7000-8000-000000000601';
const home: HouseHome = {
  houseId,
  name: 'Knights at Dusk',
  description: 'Friendly games every week.',
  emblemSeed: `house:${houseId}`,
  timeZone: 'Asia/Kolkata',
  membershipRole: 'owner',
};
const emptyShelf: MoveShelf = { yourMove: [], waiting: [], recent: [] };
const shelfWithGame: MoveShelf = {
  ...emptyShelf,
  waiting: [{ gameId: 'g1', opponentName: 'Max', moveDueAt: new Date('2026-09-08T12:00:00Z') }],
};
const viewedAt = new Date('2026-09-07T12:00:00.000Z');

function member(id: string, displayName: string, role: HouseRosterMember['role']) {
  return { membershipId: id, displayName, role, joinedAt: new Date('2026-09-01') };
}
const olivia = member('m-olivia', 'Olivia', 'owner');
const max = member('m-max', 'Max', 'member');
const nia = member('m-nia', 'Nia', 'member');

function roster(viewer: HouseRosterMember, members: HouseRosterMember[]): HouseRoster {
  return {
    houseId,
    memberCap: 12,
    viewerMembershipId: viewer.membershipId,
    viewerRole: viewer.role,
    members,
  };
}

const activeSeason: HouseSeasonView = {
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  title: 'September Season',
  state: 'active',
  startsAt: new Date('2026-09-04T00:00:00.000Z'),
  endsAt: new Date('2026-10-02T00:00:00.000Z'),
  charter: {
    version: 1,
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

function seat(creator: HouseRosterMember): OpenSeatListing {
  const viewerIsCreator = creator.membershipId === olivia.membershipId;
  return {
    gameId: `g-${creator.membershipId}`,
    openSeatId: `s-${creator.membershipId}`,
    mode: 'correspondence',
    clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
    nightId: null,
    offeredColor: 'any',
    creator: { membershipId: creator.membershipId, name: creator.displayName },
    intended: null,
    createdAt: viewedAt,
    expiresAt: new Date('2026-09-14T12:00:00.000Z'),
    viewerIsCreator,
    viewerMayAccept: !viewerIsCreator,
  };
}

function render(overrides: Partial<ComponentProps<typeof HouseHomeView>> = {}): string {
  return renderToStaticMarkup(
    <HouseHomeView
      home={home}
      shelf={emptyShelf}
      viewedAt={viewedAt}
      roster={roster(olivia, [olivia])}
      season={null}
      standings={[]}
      welcomeDismissed={false}
      today="2026-09-07"
      {...overrides}
    />,
  );
}

/** Each setup step as the Owner reads it: its title and whether it is done. */
function setupSteps(html: string): string[] {
  return [...html.matchAll(/<li data-step="(\w+)"( data-done="true")?/g)].map(
    ([, step, done]) => `${step}${done ? ' done' : ''}`,
  );
}

describe('House home view', () => {
  it('[BM-013] [UX-IA-01] renders the member-visible House details', () => {
    const html = render();

    expect(html).toContain('<h1');
    expect(html).toContain('Knights at Dusk');
    expect(html).toContain('Friendly games every week.');
    expect(html).toContain('Asia/Kolkata');
    expect(html).toContain('Owner');
  });

  it('[BM-013] [UX-IMG-01] gives the deterministic emblem the House name', () => {
    const html = render();

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Knights at Dusk emblem"');
  });

  it('[BM-013] [PR-DEF-02] gives a House without a description an on-voice prompt', () => {
    const html = render({ home: { ...home, description: null } });

    expect(html).toContain('A quiet table, ready for the first game.');
  });
});

describe('House home setup for an Owner', () => {
  it('[BM-013] leads a new, empty House with inviting the group', () => {
    const html = render();

    expect(html).toContain('Get Knights at Dusk ready');
    expect(html).toContain('0 of 3 done');
    expect(setupSteps(html)).toEqual(['invite', 'season', 'game']);
    expect(html).toContain(
      `<a class="house-guide__primary" href="/h/${houseId}/members#invite">Invite people</a>`,
    );
    expect(html).toContain('Four weeks from today, with live Nights on Fridays at 19:30.');
    expect(html).toContain('>Open the Season</button>');
    expect(html).not.toContain('Welcome to');
    expect(html.match(/class="[^"]*house-guide__primary"/g)).toHaveLength(1);
    expect(html.match(/class="house-status__action"/g)).toBeNull();
  });

  it('[BM-013] marks done steps and points at the first game once the House has a Season', () => {
    const html = render({ roster: roster(olivia, [olivia, max]), season: activeSeason });

    expect(html).toContain('2 of 3 done');
    expect(setupSteps(html)).toEqual(['invite done', 'season done', 'game']);
    expect(html.match(/>Done</g)).toHaveLength(2);
    expect(html).toContain(
      `<a class="house-guide__primary" href="/h/${houseId}/games/new">Start a game</a>`,
    );
    expect(html).not.toContain('Open the Season</button>');
  });

  it('[BM-013] makes opening the Season the next step once someone has joined', () => {
    const html = render({ roster: roster(olivia, [olivia, max]) });

    expect(setupSteps(html)).toEqual(['invite done', 'season', 'game']);
    expect(html).toContain('<button type="button" class="house-guide__primary">Open the Season');
  });

  it.each([
    ['opens a seat', { openSeats: [seat(olivia)] }],
    ['has a game', { shelf: shelfWithGame }],
  ])('[BM-013] puts setup away once the Owner %s', (_case, overrides) => {
    const html = render({
      roster: roster(olivia, [olivia, max]),
      season: activeSeason,
      ...overrides,
    });

    expect(html).not.toContain('house-setup');
    expect(html).not.toContain('Welcome to');
  });

  it('[BM-013] does not count someone else’s open seat as the Owner’s first game', () => {
    const html = render({
      roster: roster(olivia, [olivia, max]),
      season: activeSeason,
      openSeats: [seat(max)],
    });

    expect(setupSteps(html)).toEqual(['invite done', 'season done', 'game']);
  });
});

describe('House home welcome for a new Member', () => {
  const memberHome = { ...home, membershipRole: 'member' as const };

  it('[BM-013] explains the Season in plain words and offers to challenge the only other Member', () => {
    const html = render({
      home: memberHome,
      roster: roster(max, [olivia, max]),
      season: activeSeason,
    });

    expect(html).toContain('<h2 id="house-welcome-title">Welcome to Knights at Dusk</h2>');
    expect(html).toContain('<li>One move every 24 hours. Your games wait here.</li>');
    expect(html).toContain('<li>Fridays at 19:30: live games and chat.</li>');
    expect(html).toContain(
      '<li>Every game earns Season points. Most points at the end of the Season wins.</li>',
    );
    expect(html).toContain(`href="/h/${houseId}/games/new?opponent=m-olivia">Challenge Olivia</a>`);
    expect(html).toContain('>Got it</button>');
    expect(html).not.toContain('house-setup');
  });

  it('[BM-013] says the Season has not started and offers any game in a fuller House', () => {
    const html = render({ home: memberHome, roster: roster(max, [olivia, max, nia]) });

    expect(html).toContain('<li>The Season has not started yet.</li>');
    expect(html).not.toContain('One move every');
    expect(html).toContain(
      `<a class="house-guide__primary" href="/h/${houseId}/games/new">Start a game</a>`,
    );
  });

  it('[BM-013] sends the newcomer to a challenge that is already waiting for them', () => {
    const challenge = {
      ...seat(olivia),
      intended: { membershipId: max.membershipId, name: 'Max' },
      viewerIsCreator: false,
      viewerMayAccept: true,
    };
    const html = render({
      home: memberHome,
      roster: roster(max, [olivia, max]),
      season: activeSeason,
      openSeats: [challenge],
    });

    expect(html).toContain('href="#open-seats">Answer Olivia’s challenge</a>');
    expect(html).not.toContain('Challenge Olivia</a>');
  });

  it.each([
    ['dismissed it on this device', { welcomeDismissed: true }],
    ['already has a game', { shelf: shelfWithGame }],
  ])('[BM-013] stays out of the way once the Member %s', (_case, overrides) => {
    const html = render({ home: memberHome, roster: roster(max, [olivia, max]), ...overrides });

    expect(html).not.toContain('Welcome to');
  });
});

describe('House home Season table', () => {
  it('[BM-034] shows the top five and the viewer’s own place below them', () => {
    const others = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      member(`m-${id}`, `Player ${id}`, 'member'),
    );
    const viewerRoster = roster(nia, [olivia, nia, ...others]);
    const rows = standingRows(
      [
        { membershipId: 'm-a', points: 9 },
        { membershipId: 'm-b', points: 9 },
        { membershipId: 'm-c', points: 7 },
        { membershipId: 'm-d', points: 5 },
        { membershipId: 'm-e', points: 4 },
        { membershipId: 'm-olivia', points: 3 },
        { membershipId: 'm-nia', points: 1 },
      ],
      viewerRoster,
    );
    const html = render({
      home: { ...home, membershipRole: 'member' },
      roster: viewerRoster,
      season: activeSeason,
      standings: rows,
      shelf: shelfWithGame,
    });

    expect(html).toContain('<h2 id="house-table-title">Season table</h2>');
    const shown = [...html.matchAll(/aria-label="Rank (\d+)"/g)].map(([, rank]) => Number(rank));
    expect(shown).toEqual([1, 1, 3, 4, 5, 7]);
    expect(html).not.toContain('Olivia');
    expect(html).toMatch(/data-below="true">.*Nia<span class="roster__you">You<\/span>/);
    expect(html).toContain(`href="/h/${houseId}/season">Full table</a>`);
  });

  it('[BM-034] says nobody has points yet, and hides the table between Seasons', () => {
    expect(render({ season: activeSeason })).toContain('No points yet.');
    expect(render({ season: null })).not.toContain('Season table</h2>');
  });
});
