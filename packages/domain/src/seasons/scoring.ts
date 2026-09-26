import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { AuthorizeHouseAction } from '../houses/authorization';

export const GAME_COMPLETED_SCORING_TOPIC = 'game.completed';
export const PUZZLE_PUBLISHED_SCORING_TOPIC = 'puzzle.published';
export const SEASON_RESULT_RECORDED_TOPIC = 'season.result-recorded';

export type SeasonScoreSourceKind =
  'game_played' | 'game_win' | 'game_draw' | 'night_attendance' | 'puzzle_published';

export type SeasonScoreCapKind = 'games' | 'nights' | 'puzzles';

export interface SeasonScoreAward {
  readonly membershipId: string;
  readonly sourceId: string;
  readonly sourceKind: SeasonScoreSourceKind;
  readonly sourceKey: string;
  /** One key shared by every ledger row awarded to this Member for this source. */
  readonly capSourceKey: string;
  readonly points: number;
  readonly capKind: SeasonScoreCapKind;
  readonly cap: number;
}

export interface CompletedGameScoringSource {
  readonly gameId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly whiteMembershipId: string;
  readonly blackMembershipId: string;
  readonly result: 'white_win' | 'black_win' | 'draw';
}

export interface SeasonScoreLedgerCandidate extends SeasonScoreAward {
  readonly id: string;
}

export interface SeasonScoreLedgerEntry {
  readonly id: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly membershipId: string;
  readonly sourceKind: SeasonScoreSourceKind;
  readonly sourceKey: string;
  readonly points: number;
  readonly createdAt: Date;
}

export type SeasonScoreAppendOutcome = 'recorded' | 'capped' | 'duplicate';

export interface SeasonScoreAppendResult {
  readonly outcome: SeasonScoreAppendOutcome;
  readonly entries: readonly SeasonScoreLedgerEntry[];
}

export interface SeasonStanding {
  readonly membershipId: string;
  readonly points: number;
}

export interface SeasonStandings {
  readonly houseId: string;
  readonly seasonId: string;
  /** [BM-047] True once closing froze the standings snapshot; later ledger rows do not count. */
  readonly finalized: boolean;
  readonly standings: readonly SeasonStanding[];
}

export interface SeasonScoringRepository {
  findCompletedGame(houseId: string, gameId: string): Promise<CompletedGameScoringSource | null>;
  findSeasonAt(houseId: string, occurredAt: Date): Promise<string | null>;
  append(input: {
    readonly houseId: string;
    readonly seasonId: string;
    readonly entries: readonly SeasonScoreLedgerCandidate[];
    readonly createdAt: Date;
    readonly recordedAt: Date;
    readonly resultEventId: string;
    readonly sourceEventId: string;
    readonly sourceTopic: string;
  }): Promise<SeasonScoreAppendResult>;
  readStandings(context: AuthorizationContext, seasonId: string): Promise<SeasonStandings | null>;
}

export interface ReadSeasonStandingsRequest {
  readonly houseId: string;
  readonly seasonId: string;
  readonly viewer: Viewer;
}

export interface ReadSeasonStandingsDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly scoring: Pick<SeasonScoringRepository, 'readStandings'>;
}

export interface SeasonScoringEventObservation {
  readonly eventId: string;
  readonly houseId: string | null;
  readonly seasonId: string | null;
  readonly topic: string;
  readonly outcome: SeasonScoreAppendOutcome | 'failed';
  readonly ledgerEntryCount: number;
  readonly points: number;
}

export interface SeasonScoringEventRecorder {
  record(observation: SeasonScoringEventObservation): void;
}

function gameAward(
  gameId: string,
  membershipId: string,
  result: 'played' | 'win' | 'draw',
): SeasonScoreAward {
  const sourceKey = `game:${gameId}:${result}`;
  return {
    membershipId,
    sourceId: gameId,
    sourceKind: result === 'win' ? 'game_win' : result === 'draw' ? 'game_draw' : 'game_played',
    sourceKey,
    capSourceKey: sourceKey,
    points: result === 'win' ? 3 : result === 'draw' ? 2 : 1,
    capKind: 'games',
    cap: 8,
  };
}

/** [BM-034] [DR-SCORE-01..04] Apply the fixed Game recipe without I/O. */
export function scoreCompletedGame(
  source: CompletedGameScoringSource,
): readonly SeasonScoreAward[] {
  if (source.result === 'white_win') {
    return [
      gameAward(source.gameId, source.whiteMembershipId, 'win'),
      gameAward(source.gameId, source.blackMembershipId, 'played'),
    ];
  }
  if (source.result === 'black_win') {
    return [
      gameAward(source.gameId, source.whiteMembershipId, 'played'),
      gameAward(source.gameId, source.blackMembershipId, 'win'),
    ];
  }
  return [
    gameAward(source.gameId, source.whiteMembershipId, 'draw'),
    gameAward(source.gameId, source.blackMembershipId, 'draw'),
  ];
}

/** [BM-034] [DR-SCORE-05/08] Apply the fixed qualified-Night award. */
export function nightAttendanceScore(nightId: string, membershipId: string): SeasonScoreAward {
  const sourceKey = `night:${nightId}`;
  return {
    membershipId,
    sourceId: nightId,
    sourceKind: 'night_attendance',
    sourceKey,
    capSourceKey: sourceKey,
    points: 1,
    capKind: 'nights',
    cap: 4,
  };
}

/** [BM-034] [DR-SCORE-06/08] Apply the fixed published-Puzzle award. */
export function publishedPuzzleScore(puzzleId: string, membershipId: string): SeasonScoreAward {
  const sourceKey = `puzzle:${puzzleId}`;
  return {
    membershipId,
    sourceId: puzzleId,
    sourceKind: 'puzzle_published',
    sourceKey,
    capSourceKey: sourceKey,
    points: 1,
    capKind: 'puzzles',
    cap: 2,
  };
}

/** [BM-034] [DR-SCORE-04..06] Decide cap eligibility from a durable source ordinal. */
export function isWithinSeasonScoreCap(capKind: SeasonScoreCapKind, ordinal: number): boolean {
  const caps: Readonly<Record<SeasonScoreCapKind, number>> = {
    games: 8,
    nights: 4,
    puzzles: 2,
  };
  return Number.isInteger(ordinal) && ordinal > 0 && ordinal <= caps[capKind];
}

/** [BM-034] [DR-SCORE-07] Sum an immutable ledger into deterministic standings. */
export function computeSeasonStandings(
  entries: readonly Pick<SeasonScoreLedgerEntry, 'membershipId' | 'points'>[],
): readonly SeasonStanding[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.membershipId, (totals.get(entry.membershipId) ?? 0) + entry.points);
  }
  return [...totals]
    .map(([membershipId, points]) => ({ membershipId, points }))
    .sort(
      (left, right) =>
        right.points - left.points || left.membershipId.localeCompare(right.membershipId),
    );
}
