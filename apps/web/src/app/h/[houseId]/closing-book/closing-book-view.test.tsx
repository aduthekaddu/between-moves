import type { ClosingBookContents, HouseClosingBook } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClosingBookView } from './closing-book-view';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000004901';
const ada = { membershipId: '01941f29-7c00-7000-8000-000000000621', displayName: 'Ada' };
const bea = { membershipId: '01941f29-7c00-7000-8000-000000000623', displayName: 'Bea' };
const mira = { membershipId: '01941f29-7c00-7000-8000-000000000625', displayName: 'Mira' };
const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

const contents: ClosingBookContents = {
  season: {
    seasonId,
    title: 'Autumn tables',
    startsAt: '2026-09-04T12:00:00.000Z',
    endsAt: '2026-10-02T12:00:00.000Z',
    closingAt: '2026-10-02T13:00:00.000Z',
  },
  totals: { members: 3, gamesCompleted: 2, nightsHeld: 2, puzzlesPublished: 1 },
  participation: [
    {
      ...ada,
      rank: 1,
      points: 7,
      gamesCompleted: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      nightsAttended: 2,
      puzzlesPublished: 1,
    },
    {
      ...bea,
      rank: 2,
      points: 4,
      gamesCompleted: 2,
      wins: 0,
      draws: 1,
      losses: 1,
      nightsAttended: 0,
      puzzlesPublished: 0,
    },
    {
      ...mira,
      rank: 3,
      points: 0,
      gamesCompleted: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      nightsAttended: 0,
      puzzlesPublished: 0,
    },
  ],
  awards: [
    { kind: 'season_leader', value: 7, recipients: [ada] },
    { kind: 'most_games', value: 2, recipients: [bea] },
    { kind: 'most_wins', value: 1, recipients: [ada] },
    { kind: 'night_regular', value: 2, recipients: [ada] },
    { kind: 'puzzle_setter', value: 1, recipients: [ada] },
  ],
  swings: [
    { gameId: 'g-1', ply: 6, san: 'Nf6', mover: bea, opponent: ada, swingCp: 950 },
    { gameId: 'g-2', ply: 3, san: 'Qh5', mover: bea, opponent: mira, swingCp: 320 },
  ],
  games: [
    {
      gameId: 'g-1',
      mode: 'correspondence',
      white: ada,
      black: bea,
      result: 'white_win',
      resultReason: 'checkmate',
      plies: 7,
      completedAt: '2026-09-10T20:00:00.000Z',
    },
    {
      gameId: 'g-2',
      mode: 'live',
      white: bea,
      black: mira,
      result: 'draw',
      resultReason: 'agreement',
      plies: 4,
      completedAt: '2026-09-20T10:00:00.000Z',
    },
  ],
  puzzles: [
    {
      puzzleId: 'p-1',
      prompt: 'White to play and win.',
      positionFen: fen,
      contributor: ada,
      publishedAt: '2026-09-15T10:00:00.000Z',
    },
  ],
};

/** Knights at Dusk with its published Autumn tables book, adjusted by `overrides`. */
function shelf(overrides: Partial<HouseClosingBook> = {}): HouseClosingBook {
  return {
    houseName: 'Knights at Dusk',
    timeZone: 'Asia/Kolkata',
    membershipId: ada.membershipId,
    membershipRole: 'owner',
    season: { seasonId, title: 'Autumn tables' },
    activeSeason: null,
    book: {
      bookId: '01941f29-7c00-7000-8000-000000004903',
      generationVersion: 1,
      publishedAt: new Date('2026-10-02T13:00:06.000Z'),
      contents,
    },
    ...overrides,
  };
}

/** Server-render the Closing Book view to static HTML. */
function render(value: HouseClosingBook): string {
  return renderToStaticMarkup(<ClosingBookView houseId={houseId} shelf={value} />);
}

/** The published shelf with its book contents adjusted by `overrides`. */
function withContents(overrides: Partial<ClosingBookContents>): HouseClosingBook {
  const base = shelf();
  if (base.book === null) throw new Error('fixture has a book');
  return { ...base, book: { ...base.book, contents: { ...contents, ...overrides } } };
}

describe('Closing Book view', () => {
  it('[BM-048] binds the cover with the House, Season dates, leader, and totals', () => {
    const html = render(shelf());

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="closing-book-title">Autumn tables</h1>');
    expect(html).toContain('Closing Book · Knights at Dusk');
    expect(html).toContain('4 Sept – 2 Oct 2026');
    expect(html).toContain('First place: </span>Ada');
    expect(html).toMatch(/<dt>Members<\/dt><dd>3<\/dd>/);
    expect(html).toMatch(/<dt>Games<\/dt><dd>2<\/dd>/);
    expect(html).toMatch(/<dt>Nights<\/dt><dd>2<\/dd>/);
    expect(html).toMatch(/<dt>Puzzles<\/dt><dd>1<\/dd>/);
  });

  it('[BM-048] explains every Season award with the count that earned it', () => {
    const html = render(shelf());

    expect(html).toContain('For Autumn tables only.');
    expect(html).toContain('Top of the table');
    expect(html).toContain('Finished first with 7 points.');
    expect(html).toContain('Most games finished');
    expect(html).toContain('Finished 2 games, the most this Season.');
    expect(html).toContain('Won 1 game, the most this Season.');
    expect(html).toContain('Came to 2 of 2 Between Moves Nights.');
    expect(html).toContain('Set 1 House Puzzle, the most this Season.');
    expect(html).toContain('closing-book-award closing-book-award--leader');
  });

  it('[BM-048] words a shared award for every recipient', () => {
    const html = render(
      withContents({
        totals: { ...contents.totals, nightsHeld: 4 },
        awards: [
          { kind: 'season_leader', value: 5, recipients: [ada, bea] },
          { kind: 'most_games', value: 3, recipients: [ada, bea, mira] },
          { kind: 'most_wins', value: 2, recipients: [ada, bea] },
          { kind: 'night_regular', value: 1, recipients: [ada, mira] },
          { kind: 'puzzle_setter', value: 2, recipients: [bea, mira] },
        ],
      }),
    );

    expect(html).toContain('<h3>Ada and Bea</h3>');
    expect(html).toContain('<h3>Ada, Bea and Mira</h3>');
    expect(html).toContain('Shared first place on 5 points.');
    expect(html).toContain('Each finished 3 games, the most this Season.');
    expect(html).toContain('Each won 2 games, the most this Season.');
    expect(html).toContain('Each came to 1 of 4 Between Moves Nights.');
    expect(html).toContain('Each set 2 House Puzzles, the most this Season.');
  });

  it('[BM-048] records who turned up without dwelling on what they did not do', () => {
    const html = render(shelf());

    expect(html).toContain('Rank </span>1');
    expect(html).toContain('1 game: 1 won · 2 Nights · 1 House Puzzle');
    expect(html).toContain('2 games: 1 drawn, 1 lost');
    expect(html).toContain('No games, Nights or puzzles this Season');
    expect(html).toContain('7 points');
    expect(html).toContain('0 points');
    expect(html).toContain('closing-book-roll__leader');
  });

  it('[BM-048] marks each memorable swing by its move and size', () => {
    const html = render(shelf());

    expect(html).toContain('9.5');
    expect(html).toContain('3.2');
    expect(html).toContain('Bea’s <span class="closing-book-move">3… Nf6</span>');
    expect(html).toContain('Bea’s <span class="closing-book-move">2. Qh5</span>');
    expect(html).toContain('Ada vs Bea');
    expect(html).toContain('Bea vs Mira');
  });

  it('[BM-048] lists every finished game in the House’s own time zone', () => {
    const html = render(shelf());

    expect(html).toContain('<time dateTime="2026-09-10T20:00:00.000Z">11 Sept</time>');
    expect(html).toContain('Ada beat Bea by checkmate');
    expect(html).toContain('4 moves · correspondence');
    expect(html).toContain('1–0');
    expect(html).toContain('Bea and Mira drew by agreement');
    expect(html).toContain('2 moves · live');
    expect(html).toContain('½–½');
  });

  it('[BM-048] shows each confirmed House Puzzle with its contributor and position', () => {
    const html = render(shelf());

    expect(html).toContain('White to play and win.');
    expect(html).toContain('Set by Ada · 15 Sept');
    expect(html).toContain(`aria-label="Chess position: ${fen}"`);
    expect(html).toContain('White to move');
  });

  it('[BM-048] explains how the book was bound', () => {
    expect(render(shelf())).toContain(
      'Bound 2 Oct 2026 from the House ledger and games as they stood when Autumn tables closed. Edition 1.',
    );
  });

  it('[BM-048] keeps a quiet Season’s pages honest when there is nothing to show', () => {
    const html = render(withContents({ awards: [], swings: [], games: [], puzzles: [] }));

    expect(html).toContain('No awards this Season');
    expect(html).toContain('No analysed game swung far enough to remember.');
    expect(html).toContain('No games were finished this Season.');
    expect(html).toContain('No House Puzzles were set this Season.');
  });

  it('[BM-048] says a closed Season’s book is being bound until it is published', () => {
    const html = render(shelf({ book: null }));

    expect(html).toContain('Closing Book · Autumn tables');
    expect(html).toContain('<h1 id="closing-book-title">Being bound.</h1>');
    expect(html).toContain('Autumn tables has closed.');
    expect(html).not.toContain('Season awards');
  });

  it('[BM-048] waits quietly before any Season has closed', () => {
    const html = render(shelf({ season: null, book: null }));

    expect(html).toContain('<h1 id="closing-book-title">Nothing bound yet.</h1>');
    expect(html).toContain('When a Season closes');
  });
});

describe('Closing Book next Season', () => {
  const seasonHref = `href="/h/${houseId}/season"`;

  it.each(['owner', 'steward'] as const)(
    '[BM-049] invites an %s to start the next Season from zero',
    (membershipRole) => {
      const html = render(shelf({ membershipRole }));

      expect(html).toContain('aria-labelledby="closing-book-next-title"');
      expect(html).toContain('<h2 id="closing-book-next-title">The table is open.</h2>');
      expect(html).toContain(
        'Nothing carries over from Autumn tables: points, standings and awards begin again from zero.',
      );
      expect(html).toContain(
        `<a class="closing-book-next__action" ${seasonHref}>Start the next Season</a>`,
      );
    },
  );

  it('[BM-049] tells a Member the table is open without offering the Charter', () => {
    const html = render(shelf({ membershipId: bea.membershipId, membershipRole: 'member' }));

    expect(html).toContain('<h2 id="closing-book-next-title">The table is open.</h2>');
    expect(html).toContain('When an Owner or Steward opens the next Season');
    expect(html).toContain('Autumn tables stays here, on the House’s shelf.');
    expect(html).not.toContain('Start the next Season');
    expect(html).not.toContain(seasonHref);
  });

  it.each(['owner', 'member'] as const)(
    '[BM-049] shows an %s the next Season once it is under way',
    (membershipRole) => {
      const html = render(
        shelf({
          membershipRole,
          activeSeason: {
            seasonId: '01941f29-7c00-7000-8000-000000004991',
            title: 'Winter tables',
          },
        }),
      );

      expect(html).toContain('<h2 id="closing-book-next-title">Winter tables is under way.</h2>');
      expect(html).toContain('started again from zero');
      expect(html).toContain(
        `<a class="closing-book-next__action" ${seasonHref}>Open the Season table</a>`,
      );
      expect(html).not.toContain('Start the next Season');
    },
  );

  it('[BM-049] keeps the next Season after the book, outside its article', () => {
    const html = render(shelf());

    expect(html.indexOf('</article>')).toBeLessThan(html.indexOf('closing-book-next'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('[BM-049] says nothing about the next Season while the book is being bound', () => {
    expect(render(shelf({ book: null }))).not.toContain('closing-book-next');
    expect(render(shelf({ season: null, book: null }))).not.toContain('closing-book-next');
  });
});
