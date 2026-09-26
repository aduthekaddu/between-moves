import {
  DomainError,
  FIXED_MVP_POINTS_RECIPE,
  transitionSeasonState,
  validateCharter,
  validateSeasonTitle,
  validateSeasonWindow,
  type CharterDraftResult,
  type CloseSeasonDependencies,
  type CloseSeasonRequest,
  type DraftSeasonCharterRequest,
  type DraftSeasonRequest,
  type PublishSeasonRequest,
  type SeasonCloseResult,
  type SeasonDependencies,
  type SeasonDraftResult,
  type SeasonPublishResult,
  type SeasonState,
  type SeasonTransitionEvent,
} from '@between-moves/domain';

function errorOutcome(error: unknown): 'rejected' | 'error' {
  return error instanceof DomainError ? 'rejected' : 'error';
}

type TransitionDependencies = Pick<SeasonDependencies, 'transitions'>;

/** Record a transition while suppressing recorder failures. */
function recordTransition(
  dependencies: TransitionDependencies,
  observation: Parameters<SeasonDependencies['transitions']['record']>[0],
): void {
  try {
    dependencies.transitions.record(observation);
  } catch {
    // Observability failure must never change the committed command outcome.
  }
}

/**
 * Return the operation's result or rethrow its failure; recorder failures are suppressed.
 * `recordSuccess` can suppress a success observation by returning false, as on a replay.
 */
async function observeTransition<T>(input: {
  readonly actorId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly event: SeasonTransitionEvent;
  readonly from: SeasonState | null;
  readonly to: SeasonState;
  readonly dependencies: TransitionDependencies;
  readonly operation: () => Promise<T>;
  readonly recordSuccess?: (result: T) => boolean;
}): Promise<T> {
  try {
    const result = await input.operation();
    if (input.recordSuccess?.(result) !== false) {
      recordTransition(input.dependencies, {
        actorId: input.actorId,
        houseId: input.houseId,
        seasonId: input.seasonId,
        event: input.event,
        from: input.from,
        to: input.to,
        outcome: 'success',
      });
    }
    return result;
  } catch (error) {
    recordTransition(input.dependencies, {
      actorId: input.actorId,
      houseId: input.houseId,
      seasonId: input.seasonId,
      event: input.event,
      from: input.from,
      to: input.to,
      outcome: errorOutcome(error),
    });
    throw error;
  }
}

/** [BM-018] [DR-SEASON-01/04] Create an authorized House-scoped draft Season. */
export async function draftSeason(
  request: DraftSeasonRequest,
  dependencies: SeasonDependencies,
): Promise<SeasonDraftResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'draft_or_publish_charter' },
    request.houseId,
    request.viewer,
  );
  const seasonId = dependencies.ids.generate();
  const to = transitionSeasonState(null, 'draft_season');
  const createdAt = dependencies.clock.now();
  return observeTransition({
    actorId: request.viewer.userId,
    houseId: request.houseId,
    seasonId,
    event: 'draft_season',
    from: null,
    to,
    dependencies,
    recordSuccess: (result) => result.createdNow,
    operation: () => {
      const title = validateSeasonTitle(request.title);
      return dependencies.seasons.draft(context, {
        seasonId,
        title,
        idempotencyKey: request.idempotencyKey,
        createdAt,
      });
    },
  });
}

/** [BM-018] [DR-SEASON-02/03] Add the next validated Charter version to a draft Season. */
export async function draftSeasonCharter(
  request: DraftSeasonCharterRequest,
  dependencies: SeasonDependencies,
): Promise<CharterDraftResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'draft_or_publish_charter' },
    request.houseId,
    request.viewer,
  );
  validateCharter(request);
  return dependencies.seasons.draftCharter(context, {
    charterId: dependencies.ids.generate(),
    seasonId: request.seasonId,
    correspondencePaceHours: request.correspondencePaceHours,
    nightRecurrence: request.nightRecurrence,
    pointsRecipe: FIXED_MVP_POINTS_RECIPE,
    createdAt: dependencies.clock.now(),
  });
}

/** [BM-018] [DR-SEASON-03..05] Publish one Charter and activate its Season atomically. */
export async function publishSeason(
  request: PublishSeasonRequest,
  dependencies: SeasonDependencies,
): Promise<SeasonPublishResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'draft_or_publish_charter' },
    request.houseId,
    request.viewer,
  );
  const to = transitionSeasonState('draft', 'publish_season');
  const publishedAt = dependencies.clock.now();
  return observeTransition({
    actorId: request.viewer.userId,
    houseId: request.houseId,
    seasonId: request.seasonId,
    event: 'publish_season',
    from: 'draft',
    to,
    dependencies,
    recordSuccess: (result) => result.activatedNow,
    operation: () => {
      const title = validateSeasonTitle(request.title);
      validateSeasonWindow(request.startsAt, request.endsAt);
      return dependencies.seasons.publish(context, {
        seasonId: request.seasonId,
        title,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        publishedAt,
        nightIds: [
          dependencies.ids.generate(),
          dependencies.ids.generate(),
          dependencies.ids.generate(),
          dependencies.ids.generate(),
        ],
      });
    },
  });
}

/**
 * [BM-047] Close an active Season: lock it into `closing` with a standings snapshot and the
 * `season.closing` event, then finalize it as `closed`. A retry resumes a stranded closing.
 * Require Owner/Steward authorization. Return final standings and the close time; a closed
 * Season returns its saved standings and original close time with `closedNow: false`.
 * Authorization and repository errors propagate, including unavailable-Season and invalid-state
 * errors. A finalization failure can leave the committed closing step available for retry.
 */
export async function closeSeason(
  request: CloseSeasonRequest,
  dependencies: CloseSeasonDependencies,
): Promise<SeasonCloseResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'close_season' },
    request.houseId,
    request.viewer,
  );
  const transition = {
    actorId: request.viewer.userId,
    houseId: request.houseId,
    seasonId: request.seasonId,
    dependencies,
  };
  await observeTransition({
    ...transition,
    event: 'close_season',
    from: 'active',
    to: transitionSeasonState('active', 'close_season'),
    recordSuccess: (result) => result.closingNow,
    operation: () =>
      dependencies.seasons.beginClosing(context, {
        seasonId: request.seasonId,
        closingEventId: dependencies.ids.generate(),
        closingAt: dependencies.clock.now(),
      }),
  });
  return observeTransition({
    ...transition,
    event: 'finalize_season',
    from: 'closing',
    to: transitionSeasonState('closing', 'finalize_season'),
    recordSuccess: (result) => result.closedNow,
    operation: () =>
      dependencies.seasons.finalize(context, {
        seasonId: request.seasonId,
        closedAt: dependencies.clock.now(),
      }),
  });
}
