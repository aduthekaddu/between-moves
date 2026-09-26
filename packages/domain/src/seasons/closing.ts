import type { AuthenticatedViewer, Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { Clock } from '../shared/clock';
import type { IdGenerator } from '../houses/house';
import type { SeasonStanding } from './scoring';
import type { SeasonTransitionRecorder } from './index';

/** Outbox topic that hands a finalized Season to Closing Book generation. */
export const SEASON_CLOSING_TOPIC = 'season.closing';

export interface RankedSeasonStanding extends SeasonStanding {
  /** Competition rank: tied points share a rank and the next rank skips. */
  readonly rank: number;
}

export interface SeasonClosingInput {
  readonly seasonId: string;
  readonly closingEventId: string;
  readonly closingAt: Date;
}

export interface SeasonClosingResult {
  readonly seasonId: string;
  readonly houseId: string;
  readonly state: 'closing' | 'closed';
  readonly standings: readonly RankedSeasonStanding[];
  /** False when a retry found the Season already closing or closed. */
  readonly closingNow: boolean;
  readonly actorMembershipId: string;
}

export interface SeasonFinalizeInput {
  readonly seasonId: string;
  readonly closedAt: Date;
}

export interface SeasonCloseResult {
  readonly seasonId: string;
  readonly houseId: string;
  readonly state: 'closed';
  readonly closedAt: Date;
  readonly standings: readonly RankedSeasonStanding[];
  /** False when a retry found the Season already closed. */
  readonly closedNow: boolean;
  readonly actorMembershipId: string;
}

export interface SeasonClosingRepository {
  /** Lock an active Season, snapshot its standings, and enqueue `season.closing`. */
  beginClosing(
    context: AuthorizationContext,
    input: SeasonClosingInput,
  ): Promise<SeasonClosingResult>;
  /**
   * Move a closing Season to closed and return its saved standings, which may be empty.
   * A closed Season replays its original close time with `closedNow: false`.
   */
  finalize(context: AuthorizationContext, input: SeasonFinalizeInput): Promise<SeasonCloseResult>;
}

export interface CloseSeasonRequest {
  readonly houseId: string;
  readonly seasonId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface CloseSeasonDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly seasons: SeasonClosingRepository;
  readonly transitions: SeasonTransitionRecorder;
}

export interface FinalSeasonStanding extends RankedSeasonStanding {
  readonly displayName: string;
}

/** The closing or most recently closed House Season and its immutable final standings. */
export interface ClosedSeasonView {
  readonly seasonId: string;
  readonly title: string;
  /** `closing` when a close is still unfinished; its standings are already frozen. */
  readonly state: 'closing' | 'closed';
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly closedAt: Date | null;
  readonly standings: readonly FinalSeasonStanding[];
}

export interface ClosedSeasonReadRepository {
  readLatestClosed(context: AuthorizationContext): Promise<ClosedSeasonView | null>;
}

export interface ReadLastClosedSeasonRequest {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadLastClosedSeasonDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly seasons: ClosedSeasonReadRepository;
}

/** [BM-047] Rank ledger totals deterministically; ties share a competition rank. */
export function rankFinalStandings(
  standings: readonly SeasonStanding[],
): readonly RankedSeasonStanding[] {
  const ordered = [...standings].sort(
    (left, right) =>
      right.points - left.points || left.membershipId.localeCompare(right.membershipId),
  );
  let rank = 0;
  return ordered.map((standing, index) => {
    if (index === 0 || ordered[index - 1]?.points !== standing.points) rank = index + 1;
    return { membershipId: standing.membershipId, points: standing.points, rank };
  });
}
