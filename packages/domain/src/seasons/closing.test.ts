import { describe, expect, it } from 'vitest';
import { rankFinalStandings } from './closing';

describe('Season final standings', () => {
  it('[BM-047] ranks by points with shared competition ranks for ties', () => {
    expect(
      rankFinalStandings([
        { membershipId: 'c', points: 4 },
        { membershipId: 'a', points: 7 },
        { membershipId: 'd', points: 0 },
        { membershipId: 'b', points: 4 },
        { membershipId: 'e', points: 7 },
      ]),
    ).toEqual([
      { membershipId: 'a', points: 7, rank: 1 },
      { membershipId: 'e', points: 7, rank: 1 },
      { membershipId: 'b', points: 4, rank: 3 },
      { membershipId: 'c', points: 4, rank: 3 },
      { membershipId: 'd', points: 0, rank: 5 },
    ]);
  });

  it('[BM-047] finalizes an empty Season without inventing standings', () => {
    expect(rankFinalStandings([])).toEqual([]);
  });

  it('[BM-047] does not mutate the ledger totals it ranks', () => {
    const totals = [
      { membershipId: 'b', points: 1 },
      { membershipId: 'a', points: 2 },
    ];
    rankFinalStandings(totals);
    expect(totals.map((standing) => standing.membershipId)).toEqual(['b', 'a']);
  });
});
