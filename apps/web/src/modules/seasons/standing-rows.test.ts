import type { HouseRosterMember } from '@between-moves/domain';
import { describe, expect, it } from 'vitest';
import { standingRows, standingsPreview } from './standing-rows';

function member(id: string, displayName: string): HouseRosterMember {
  return { membershipId: id, displayName, role: 'member', joinedAt: new Date('2026-10-01') };
}

const roster = {
  viewerMembershipId: 'm-nia',
  members: [
    member('m-olivia', 'Olivia'),
    member('m-max', 'Max'),
    member('m-nia', 'Nia'),
    member('m-theo', 'Theo'),
  ],
};

/** What a reader sees on each line of the table. */
function lines(rows: ReturnType<typeof standingRows>): string[] {
  return rows.map(
    (row) => `${row.rank} ${row.displayName} ${row.points}${row.isViewer ? ' (you)' : ''}`,
  );
}

describe('standingRows', () => {
  it('[BM-034] lets tied points share a rank and skips the next one', () => {
    const rows = standingRows(
      [
        { membershipId: 'm-theo', points: 1 },
        { membershipId: 'm-olivia', points: 4 },
        { membershipId: 'm-nia', points: 3 },
        { membershipId: 'm-max', points: 4 },
      ],
      roster,
    );

    expect(lines(rows)).toEqual(['1 Max 4', '1 Olivia 4', '3 Nia 3 (you)', '4 Theo 1']);
  });

  it('[BM-034] shares a rank three ways and keeps someone who left on the table', () => {
    const rows = standingRows(
      [
        { membershipId: 'm-max', points: 2 },
        { membershipId: 'm-gone', points: 5 },
        { membershipId: 'm-theo', points: 2 },
        { membershipId: 'm-nia', points: 2 },
      ],
      roster,
    );

    expect(lines(rows)).toEqual(['1 Former member 5', '2 Max 2', '2 Nia 2 (you)', '2 Theo 2']);
  });

  it('[BM-034] has no rows before anyone scores', () => {
    expect(standingRows([], roster)).toEqual([]);
  });
});

describe('standingsPreview', () => {
  const ranked = standingRows(
    ['a', 'b', 'c', 'd', 'e', 'f', 'm-nia'].map((id, index) => ({
      membershipId: id,
      points: 20 - index,
    })),
    roster,
  );

  it('[BM-034] shows the top five and the viewer below them', () => {
    const preview = standingsPreview(ranked);

    expect(preview.top.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(preview.viewer?.rank).toBe(7);
    expect(preview.viewer?.displayName).toBe('Nia');
  });

  it('[BM-034] does not repeat a viewer who is already in the top five', () => {
    const preview = standingsPreview(ranked, 7);

    expect(preview.top).toHaveLength(7);
    expect(preview.viewer).toBeNull();
  });
});
