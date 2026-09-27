import { describe, expect, it } from 'vitest';
import {
  closingBookAwards,
  composeClosingBook,
  memorableSwings,
  type ClosingBookGame,
  type ClosingBookParticipant,
  type ClosingBookSource,
} from './closing-book';

const ada = { membershipId: 'm-ada', displayName: 'Ada' };
const bea = { membershipId: 'm-bea', displayName: 'Bea' };
const cy = { membershipId: 'm-cy', displayName: 'Cy' };
const dev = { membershipId: 'm-dev', displayName: 'Dev' };

/** A finished correspondence Game of 40 plies; draws end by agreement, wins by checkmate. */
function game(
  gameId: string,
  white: typeof ada,
  black: typeof ada,
  result: ClosingBookGame['result'],
  completedAt: string,
): ClosingBookGame {
  return {
    gameId,
    mode: 'correspondence',
    white,
    black,
    result,
    resultReason: result === 'draw' ? 'agreement' : 'checkmate',
    plies: 40,
    completedAt,
  };
}

const source: ClosingBookSource = {
  season: {
    seasonId: 'season-1',
    title: 'Autumn tables',
    startsAt: '2026-09-04T12:00:00.000Z',
    endsAt: '2026-10-02T12:00:00.000Z',
    closingAt: '2026-10-02T13:00:00.000Z',
  },
  standings: [
    { ...ada, rank: 1, points: 9 },
    { ...cy, rank: 2, points: 4 },
    { ...bea, rank: 2, points: 4 },
    { ...dev, rank: 4, points: 0 },
  ],
  games: [
    game('g-3', bea, cy, 'draw', '2026-09-20T10:00:00.000Z'),
    game('g-1', ada, bea, 'white_win', '2026-09-10T10:00:00.000Z'),
    game('g-2', cy, ada, 'white_win', '2026-09-12T10:00:00.000Z'),
    game('g-4', ada, cy, 'black_win', '2026-09-25T10:00:00.000Z'),
  ],
  swings: [
    { gameId: 'g-1', ply: 17, san: 'Qxd5', moverMembershipId: bea.membershipId, swingCp: 450 },
    { gameId: 'g-1', ply: 23, san: 'Rxe1', moverMembershipId: bea.membershipId, swingCp: 610 },
    { gameId: 'g-2', ply: 30, san: 'Kg1', moverMembershipId: ada.membershipId, swingCp: 280 },
    { gameId: 'g-3', ply: 12, san: 'Nf3', moverMembershipId: cy.membershipId, swingCp: 390 },
    { gameId: 'g-4', ply: 8, san: 'e5', moverMembershipId: cy.membershipId, swingCp: 390 },
  ],
  puzzles: [
    {
      puzzleId: 'p-2',
      prompt: 'Find the quiet move.',
      positionFen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      contributor: bea,
      publishedAt: '2026-09-22T10:00:00.000Z',
    },
    {
      puzzleId: 'p-1',
      prompt: 'White to play and win.',
      positionFen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      contributor: ada,
      publishedAt: '2026-09-14T10:00:00.000Z',
    },
  ],
  nightsHeld: 3,
  attendance: [
    { membershipId: cy.membershipId, nights: 3 },
    { membershipId: ada.membershipId, nights: 2 },
  ],
};

/** A participant with every count at zero, adjusted by `overrides`. */
function participant(
  member: typeof ada,
  overrides: Partial<ClosingBookParticipant> = {},
): ClosingBookParticipant {
  return {
    ...member,
    rank: 1,
    points: 0,
    gamesCompleted: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    nightsAttended: 0,
    puzzlesPublished: 0,
    ...overrides,
  };
}

describe('Closing Book composition', () => {
  it('[BM-048] records every finalized Member’s participation in rank then name order', () => {
    expect(composeClosingBook(source).participation).toEqual([
      participant(ada, {
        rank: 1,
        points: 9,
        gamesCompleted: 3,
        wins: 1,
        losses: 2,
        nightsAttended: 2,
        puzzlesPublished: 1,
      }),
      participant(bea, {
        rank: 2,
        points: 4,
        gamesCompleted: 2,
        draws: 1,
        losses: 1,
        puzzlesPublished: 1,
      }),
      participant(cy, {
        rank: 2,
        points: 4,
        gamesCompleted: 3,
        wins: 2,
        draws: 1,
        nightsAttended: 3,
      }),
      participant(dev, { rank: 4 }),
    ]);
  });

  it('[BM-048] orders completed Games and House Puzzles as the Season happened', () => {
    const book = composeClosingBook(source);

    expect(book.games.map((entry) => entry.gameId)).toEqual(['g-1', 'g-2', 'g-3', 'g-4']);
    expect(book.puzzles.map((entry) => entry.puzzleId)).toEqual(['p-1', 'p-2']);
    expect(book.totals).toEqual({
      members: 4,
      gamesCompleted: 4,
      nightsHeld: 3,
      puzzlesPublished: 2,
    });
    expect(book.season).toBe(source.season);
  });

  it('[BM-048] produces the same book however the source rows arrive, without mutating them', () => {
    const reversed: ClosingBookSource = {
      ...source,
      standings: [...source.standings].reverse(),
      games: [...source.games].reverse(),
      swings: [...source.swings].reverse(),
      puzzles: [...source.puzzles].reverse(),
      attendance: [...source.attendance].reverse(),
    };
    const firstGameIds = source.games.map((entry) => entry.gameId);

    expect(composeClosingBook(reversed)).toEqual(composeClosingBook(source));
    expect(source.games.map((entry) => entry.gameId)).toEqual(firstGameIds);
  });

  it('[BM-048] binds a quiet Season with empty sections and no awards', () => {
    const book = composeClosingBook({
      ...source,
      standings: [{ ...ada, rank: 1, points: 0 }],
      games: [],
      swings: [],
      puzzles: [],
      nightsHeld: 0,
      attendance: [],
    });

    expect(book.participation).toEqual([participant(ada)]);
    expect(book.awards).toEqual([]);
    expect(book.swings).toEqual([]);
    expect(book.totals).toEqual({
      members: 1,
      gamesCompleted: 0,
      nightsHeld: 0,
      puzzlesPublished: 0,
    });
  });
});

describe('Closing Book awards', () => {
  it('[BM-048] explains each award with the Season count that earned it', () => {
    expect(composeClosingBook(source).awards).toEqual([
      { kind: 'season_leader', value: 9, recipients: [ada] },
      { kind: 'most_games', value: 3, recipients: [ada, cy] },
      { kind: 'most_wins', value: 2, recipients: [cy] },
      { kind: 'night_regular', value: 3, recipients: [cy] },
      { kind: 'puzzle_setter', value: 1, recipients: [ada, bea] },
    ]);
  });

  it('[BM-048] shares a tied award and never awards a count of zero', () => {
    expect(
      closingBookAwards([
        participant(ada, { points: 5, wins: 1, gamesCompleted: 1 }),
        participant(bea, { points: 5, losses: 1, gamesCompleted: 1 }),
      ]),
    ).toEqual([
      { kind: 'season_leader', value: 5, recipients: [ada, bea] },
      { kind: 'most_games', value: 1, recipients: [ada, bea] },
      { kind: 'most_wins', value: 1, recipients: [ada] },
    ]);
    expect(closingBookAwards([])).toEqual([]);
  });
});

describe('Closing Book memorable swings', () => {
  it('[BM-048] keeps each Game’s largest swing and the largest few across the Season', () => {
    expect(memorableSwings(source.swings, source.games)).toEqual([
      { gameId: 'g-1', ply: 23, san: 'Rxe1', mover: bea, opponent: ada, swingCp: 610 },
      { gameId: 'g-3', ply: 12, san: 'Nf3', mover: cy, opponent: bea, swingCp: 390 },
      { gameId: 'g-4', ply: 8, san: 'e5', mover: cy, opponent: ada, swingCp: 390 },
    ]);
  });

  it('[BM-048] prefers the earlier ply when one Game has two equal swings', () => {
    expect(
      memorableSwings(
        [
          { gameId: 'g-1', ply: 31, san: 'Qh5', moverMembershipId: ada.membershipId, swingCp: 300 },
          { gameId: 'g-1', ply: 9, san: 'Bb5', moverMembershipId: ada.membershipId, swingCp: 300 },
        ],
        source.games,
      ),
    ).toEqual([{ gameId: 'g-1', ply: 9, san: 'Bb5', mover: ada, opponent: bea, swingCp: 300 }]);
  });

  it('[BM-048] drops swings outside the book’s Games or by a Member not seated in them', () => {
    expect(
      memorableSwings(
        [
          {
            gameId: 'g-missing',
            ply: 4,
            san: 'e4',
            moverMembershipId: ada.membershipId,
            swingCp: 900,
          },
          { gameId: 'g-1', ply: 4, san: 'e4', moverMembershipId: dev.membershipId, swingCp: 800 },
        ],
        source.games,
      ),
    ).toEqual([]);
  });

  it('[BM-048] honours an explicit limit', () => {
    expect(memorableSwings(source.swings, source.games, 1)).toHaveLength(1);
  });
});
