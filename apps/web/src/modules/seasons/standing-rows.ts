import {
  rankFinalStandings,
  type FinalSeasonStanding,
  type HouseRoster,
  type SeasonStanding,
} from '@between-moves/domain';

export interface StandingRow extends FinalSeasonStanding {
  readonly isViewer: boolean;
}

/**
 * [BM-034] Ledger totals as the table Members read: most points first, tied points share a
 * rank (1, 1, 3) and are listed by name. Someone who has left keeps their points.
 */
export function standingRows(
  standings: readonly SeasonStanding[],
  roster: Pick<HouseRoster, 'members' | 'viewerMembershipId'>,
): readonly StandingRow[] {
  const names = new Map(roster.members.map((member) => [member.membershipId, member.displayName]));
  return rankFinalStandings(standings)
    .map((standing) => ({
      ...standing,
      displayName: names.get(standing.membershipId) ?? 'Former member',
      isViewer: standing.membershipId === roster.viewerMembershipId,
    }))
    .sort(
      (left, right) => left.rank - right.rank || left.displayName.localeCompare(right.displayName),
    );
}

/** The first `size` rows, plus the viewer's own row when it falls below them. */
export function standingsPreview(
  rows: readonly StandingRow[],
  size = 5,
): { readonly top: readonly StandingRow[]; readonly viewer: StandingRow | null } {
  const top = rows.slice(0, size);
  const viewer = rows.find((row) => row.isViewer) ?? null;
  return { top, viewer: viewer === null || top.includes(viewer) ? null : viewer };
}
