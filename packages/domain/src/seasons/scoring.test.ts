import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeSeasonStandings,
  isWithinSeasonScoreCap,
  nightAttendanceScore,
  publishedPuzzleScore,
  scoreCompletedGame,
} from './scoring';

const whiteMembershipId = '01941f29-7c00-7000-8000-000000000621';
const blackMembershipId = '01941f29-7c00-7000-8000-000000000623';

describe('BM-034 fixed Season scoring recipe', () => {
  it('[BM-034] [DR-SCORE-01..04] awards played and result points for wins and draws', () => {
    const base = {
      gameId: '01941f29-7c00-7000-8000-000000000701',
      houseId: '01941f29-7c00-7000-8000-000000000601',
      seasonId: '01941f29-7c00-7000-8000-000000000691',
      whiteMembershipId,
      blackMembershipId,
    } as const;

    expect(scoreCompletedGame({ ...base, result: 'white_win' })).toEqual([
      expect.objectContaining({
        membershipId: whiteMembershipId,
        sourceKind: 'game_win',
        points: 3,
      }),
      expect.objectContaining({
        membershipId: blackMembershipId,
        sourceKind: 'game_played',
        points: 1,
      }),
    ]);
    expect(scoreCompletedGame({ ...base, result: 'draw' })).toEqual([
      expect.objectContaining({
        membershipId: whiteMembershipId,
        sourceKind: 'game_draw',
        points: 2,
      }),
      expect.objectContaining({
        membershipId: blackMembershipId,
        sourceKind: 'game_draw',
        points: 2,
      }),
    ]);
  });

  it('[BM-034] [DR-SCORE-05/06/08] derives fixed attendance and puzzle awards', () => {
    expect(nightAttendanceScore('night-id', whiteMembershipId)).toMatchObject({
      membershipId: whiteMembershipId,
      sourceKind: 'night_attendance',
      sourceKey: 'night:night-id',
      points: 1,
      cap: 4,
    });
    expect(publishedPuzzleScore('puzzle-id', whiteMembershipId)).toMatchObject({
      membershipId: whiteMembershipId,
      sourceKind: 'puzzle_published',
      sourceKey: 'puzzle:puzzle-id',
      points: 1,
      cap: 2,
    });
  });

  it('[BM-034] [DR-SCORE-07] computes standings independently of ledger order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            membershipId: fc.constantFrom(whiteMembershipId, blackMembershipId),
            points: fc.integer({ min: 1, max: 3 }),
          }),
          { maxLength: 60 },
        ),
        fc.integer(),
        (entries, seed) => {
          const shuffled =
            fc.sample(
              fc.shuffledSubarray(entries, {
                minLength: entries.length,
                maxLength: entries.length,
              }),
              {
                seed,
                numRuns: 1,
              },
            )[0] ?? [];
          expect(computeSeasonStandings(shuffled)).toEqual(computeSeasonStandings(entries));
        },
      ),
    );
  });

  it('[BM-034] [DR-SCORE-04..06] never admits sources above any cap in any order', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(
          [
            ...Array.from(
              { length: 20 },
              (_, index) =>
                scoreCompletedGame({
                  gameId: `game-${index}`,
                  houseId: 'house-id',
                  seasonId: 'season-id',
                  whiteMembershipId,
                  blackMembershipId,
                  result: 'white_win',
                })[0]!,
            ),
            ...Array.from({ length: 10 }, (_, index) =>
              nightAttendanceScore(`night-${index}`, whiteMembershipId),
            ),
            ...Array.from({ length: 6 }, (_, index) =>
              publishedPuzzleScore(`puzzle-${index}`, whiteMembershipId),
            ),
          ],
          { minLength: 36, maxLength: 36 },
        ),
        (awards) => {
          const admitted = { games: 0, nights: 0, puzzles: 0 };
          for (const award of awards) {
            if (isWithinSeasonScoreCap(award.capKind, admitted[award.capKind] + 1)) {
              admitted[award.capKind] += 1;
            }
          }
          expect(admitted).toEqual({ games: 8, nights: 4, puzzles: 2 });
        },
      ),
    );
  });

  it('[BM-034] [DR-SCORE-04] keeps capped Game points independent of delivery order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<'white_win' | 'black_win' | 'draw'>('white_win', 'black_win', 'draw'),
          {
            minLength: 8,
            maxLength: 20,
          },
        ),
        fc.integer(),
        (results, seed) => {
          const sources = results.map((result, index) => ({
            ordinal: index + 1,
            award: scoreCompletedGame({
              gameId: `game-${index}`,
              houseId: 'house-id',
              seasonId: 'season-id',
              whiteMembershipId,
              blackMembershipId,
              result,
            })[0]!,
          }));
          const shuffled =
            fc.sample(
              fc.shuffledSubarray(sources, {
                minLength: sources.length,
                maxLength: sources.length,
              }),
              {
                seed,
                numRuns: 1,
              },
            )[0] ?? [];
          const deliveredTotal = shuffled
            .filter(({ ordinal }) => isWithinSeasonScoreCap('games', ordinal))
            .reduce((total, { award }) => total + award.points, 0);
          const expectedTotal = sources
            .slice(0, 8)
            .reduce((total, { award }) => total + award.points, 0);

          expect(deliveredTotal).toBe(expectedTotal);
        },
      ),
    );
  });
});
