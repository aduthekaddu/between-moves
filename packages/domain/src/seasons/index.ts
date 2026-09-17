import type { AuthenticatedViewer, Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import type { AuthorizeHouseAction } from '../houses/authorization';
import type { IdGenerator } from '../houses/house';

export * from './scoring';

export type SeasonState = 'draft' | 'active' | 'closing' | 'closed';
export type SeasonTransitionEvent =
  'draft_season' | 'publish_season' | 'close_season' | 'generation_complete';

export interface NightRecurrence {
  readonly weekday: number;
  readonly localTime: string;
  readonly count: 4;
}

export interface PointsRecipe {
  readonly completedGame: number;
  readonly win: number;
  readonly draw: number;
  readonly nightAttendance: number;
  readonly publishedPuzzle: number;
  readonly caps: {
    readonly games: number;
    readonly nights: number;
    readonly puzzles: number;
  };
}

export const FIXED_MVP_POINTS_RECIPE: PointsRecipe = {
  completedGame: 1,
  win: 2,
  draw: 1,
  nightAttendance: 1,
  publishedPuzzle: 1,
  caps: { games: 8, nights: 4, puzzles: 2 },
};

export interface SeasonDraftInput {
  readonly seasonId: string;
  readonly title: string;
  readonly idempotencyKey: string | null;
  readonly createdAt: Date;
}

export interface SeasonDraftResult {
  readonly seasonId: string;
  readonly houseId: string;
  readonly state: 'draft';
  readonly createdNow: boolean;
}

export interface CharterDraftInput {
  readonly charterId: string;
  readonly seasonId: string;
  readonly correspondencePaceHours: number;
  readonly nightRecurrence: NightRecurrence;
  readonly pointsRecipe: PointsRecipe;
  readonly createdAt: Date;
}

export interface CharterDraftResult {
  readonly seasonId: string;
  readonly version: number;
}

export interface SeasonPublishInput {
  readonly seasonId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly publishedAt: Date;
  readonly nightIds: readonly [string, string, string, string];
}

export interface SeasonPublishResult {
  readonly seasonId: string;
  readonly houseId: string;
  readonly state: 'active';
  readonly publishedCharterVersion: number;
  readonly activatedNow: boolean;
  readonly actorMembershipId: string;
}

export interface SeasonRepository {
  draft(context: AuthorizationContext, input: SeasonDraftInput): Promise<SeasonDraftResult>;
  draftCharter(
    context: AuthorizationContext,
    input: CharterDraftInput,
  ): Promise<CharterDraftResult>;
  publish(context: AuthorizationContext, input: SeasonPublishInput): Promise<SeasonPublishResult>;
}

export interface HouseSeasonCharterView {
  readonly version: number;
  readonly correspondencePaceHours: number;
  readonly nightRecurrence: NightRecurrence;
  readonly pointsRecipe: PointsRecipe;
}

/** The current draft or active House Season shown on the Charter surface. */
export interface HouseSeasonView {
  readonly seasonId: string;
  readonly title: string;
  readonly state: SeasonState;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly charter: HouseSeasonCharterView | null;
}

export interface SeasonReadRepository {
  readCurrent(context: AuthorizationContext): Promise<HouseSeasonView | null>;
}

export interface ReadHouseSeasonRequest {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadHouseSeasonDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly seasons: SeasonReadRepository;
}

export interface SeasonTransitionObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly event: SeasonTransitionEvent;
  readonly from: SeasonState | null;
  readonly to: SeasonState;
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface SeasonTransitionRecorder {
  record(observation: SeasonTransitionObservation): void;
}

export interface DraftSeasonRequest {
  readonly houseId: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly viewer: AuthenticatedViewer;
}

export interface DraftSeasonCharterRequest {
  readonly houseId: string;
  readonly seasonId: string;
  readonly correspondencePaceHours: number;
  readonly nightRecurrence: NightRecurrence;
  readonly viewer: AuthenticatedViewer;
}

export interface PublishSeasonRequest {
  readonly houseId: string;
  readonly seasonId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly viewer: AuthenticatedViewer;
}

export interface SeasonDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly seasons: SeasonRepository;
  readonly transitions: SeasonTransitionRecorder;
}

const TRANSITIONS: Readonly<
  Record<SeasonTransitionEvent, readonly [SeasonState | null, SeasonState]>
> = {
  draft_season: [null, 'draft'],
  publish_season: ['draft', 'active'],
  close_season: ['active', 'closing'],
  generation_complete: ['closing', 'closed'],
};

/** [BM-018] [DR-SEASON-04..07] Enforce the complete Season transition graph. */
export function transitionSeasonState(
  current: SeasonState | null,
  event: SeasonTransitionEvent,
): SeasonState {
  const [expected, next] = TRANSITIONS[event];
  if (current !== expected) {
    throw new DomainError('conflict', `Cannot apply ${event} to Season state ${current ?? 'none'}`);
  }
  return next;
}

/** [BM-018] [DR-SEASON-01] Normalize and validate a Season title. */
export function validateSeasonTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new DomainError('validation_failed', 'Season title must contain 1 to 80 characters');
  }
  return normalized;
}

/** [BM-018] [DR-SEASON-02/03] Validate the weekly four-Night Charter recurrence. */
export function validateCharter(input: {
  readonly correspondencePaceHours: number;
  readonly nightRecurrence: NightRecurrence;
}): void {
  if (
    !Number.isInteger(input.correspondencePaceHours) ||
    input.correspondencePaceHours <= 0 ||
    input.correspondencePaceHours > 2_147_483_647
  ) {
    throw new DomainError('validation_failed', 'Correspondence pace must be a positive hour count');
  }
  const { weekday, localTime, count } = input.nightRecurrence;
  if (
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6 ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime) ||
    count !== 4
  ) {
    throw new DomainError('validation_failed', 'Charter must schedule one Night for four weeks');
  }
}

/** [BM-018] [DR-SEASON-03] Require an exact four-week Season window. */
export function validateSeasonWindow(startsAt: Date, endsAt: Date): void {
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1_000;
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt.getTime() - startsAt.getTime() !== fourWeeksMs
  ) {
    throw new DomainError('validation_failed', 'A Season must span exactly four weeks');
  }
}
