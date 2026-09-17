import {
  GAME_COMPLETED_SCORING_TOPIC,
  NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
  PUZZLE_PUBLISHED_SCORING_TOPIC,
  PermanentOutboxError,
  nightAttendanceScore,
  publishedPuzzleScore,
  scoreCompletedGame,
  type ClaimedOutboxEvent,
  type Clock,
  type IdGenerator,
  type OutboxConsumer,
  type OutboxConsumeResult,
  type ReadSeasonStandingsDependencies,
  type ReadSeasonStandingsRequest,
  type SeasonScoreAppendResult,
  type SeasonScoreAward,
  type SeasonScoreLedgerCandidate,
  type SeasonScoringEventRecorder,
  type SeasonScoringRepository,
  type SeasonStandings,
} from '@between-moves/domain';

export interface SeasonScoringConsumerDependencies {
  readonly scoring: SeasonScoringRepository;
  readonly ids: IdGenerator;
  readonly events: SeasonScoringEventRecorder;
  readonly clock: Clock;
}

function invalidEvent(): PermanentOutboxError {
  return new PermanentOutboxError('Invalid Season scoring event');
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) throw invalidEvent();
  return value;
}

function requireHouseId(event: ClaimedOutboxEvent): string {
  if (event.houseId === null) throw invalidEvent();
  return event.houseId;
}

function withIds(
  awards: readonly SeasonScoreAward[],
  ids: IdGenerator,
): readonly SeasonScoreLedgerCandidate[] {
  return awards.map((award) => ({ ...award, id: ids.generate() }));
}

function recordObservation(
  event: ClaimedOutboxEvent,
  houseId: string,
  seasonId: string,
  result: SeasonScoreAppendResult,
  recorder: SeasonScoringEventRecorder,
): void {
  try {
    recorder.record({
      eventId: event.id,
      houseId,
      seasonId,
      topic: event.topic,
      outcome: result.outcome,
      ledgerEntryCount: result.entries.length,
      points: result.entries.reduce((total, entry) => total + entry.points, 0),
    });
  } catch {
    // Diagnostics never alter an immutable scoring result.
  }
}

function recordFailure(event: ClaimedOutboxEvent, recorder: SeasonScoringEventRecorder): void {
  try {
    recorder.record({
      eventId: event.id,
      houseId: event.houseId,
      seasonId: typeof event.payload.seasonId === 'string' ? event.payload.seasonId : null,
      topic: event.topic,
      outcome: 'failed',
      ledgerEntryCount: 0,
      points: 0,
    });
  } catch {
    // Diagnostics never replace the original scoring failure.
  }
}

async function appendAwards(
  event: ClaimedOutboxEvent,
  houseId: string,
  seasonId: string,
  awards: readonly SeasonScoreAward[],
  dependencies: SeasonScoringConsumerDependencies,
): Promise<OutboxConsumeResult> {
  const result = await dependencies.scoring.append({
    houseId,
    seasonId,
    entries: withIds(awards, dependencies.ids),
    createdAt: event.occurredAt,
    recordedAt: dependencies.clock.now(),
    resultEventId: dependencies.ids.generate(),
    sourceEventId: event.id,
    sourceTopic: event.topic,
  });
  recordObservation(event, houseId, seasonId, result, dependencies.events);
  return result.outcome === 'duplicate' ? 'duplicate' : 'processed';
}

async function consumeCompletedGame(
  event: ClaimedOutboxEvent,
  dependencies: SeasonScoringConsumerDependencies,
): Promise<OutboxConsumeResult> {
  const houseId = requireHouseId(event);
  const source = await dependencies.scoring.findCompletedGame(houseId, event.aggregateId);
  if (source === null || source.houseId !== houseId || source.gameId !== event.aggregateId) {
    throw invalidEvent();
  }
  return appendAwards(event, houseId, source.seasonId, scoreCompletedGame(source), dependencies);
}

async function consumeAttendance(
  event: ClaimedOutboxEvent,
  dependencies: SeasonScoringConsumerDependencies,
): Promise<OutboxConsumeResult> {
  const houseId = requireHouseId(event);
  const membershipId = stringField(event.payload, 'membershipId');
  const nightId = stringField(event.payload, 'nightId');
  const seasonId = stringField(event.payload, 'seasonId');
  if (
    event.payload.points !== 1 ||
    event.payload.sourceKind !== 'night_attendance' ||
    event.payload.sourceKey !== `night:${nightId}`
  ) {
    throw invalidEvent();
  }
  return appendAwards(
    event,
    houseId,
    seasonId,
    [nightAttendanceScore(nightId, membershipId)],
    dependencies,
  );
}

async function consumePublishedPuzzle(
  event: ClaimedOutboxEvent,
  dependencies: SeasonScoringConsumerDependencies,
): Promise<OutboxConsumeResult> {
  const houseId = requireHouseId(event);
  const puzzleId = stringField(event.payload, 'puzzleId');
  const membershipId = stringField(event.payload, 'contributorMembershipId');
  const seasonId = await dependencies.scoring.findSeasonAt(houseId, event.occurredAt);
  if (seasonId === null) throw invalidEvent();
  return appendAwards(
    event,
    houseId,
    seasonId,
    [publishedPuzzleScore(puzzleId, membershipId)],
    dependencies,
  );
}

/** [BM-034] [DR-SCORE-01..08] Consume fixed-recipe Season scoring sources. */
export function createSeasonScoringConsumer(
  dependencies: SeasonScoringConsumerDependencies,
): OutboxConsumer {
  return {
    async consume(event) {
      try {
        if (event.topic === GAME_COMPLETED_SCORING_TOPIC) {
          return await consumeCompletedGame(event, dependencies);
        }
        if (event.topic === NIGHT_ATTENDANCE_QUALIFIED_TOPIC) {
          return await consumeAttendance(event, dependencies);
        }
        if (event.topic === PUZZLE_PUBLISHED_SCORING_TOPIC) {
          return await consumePublishedPuzzle(event, dependencies);
        }
        throw new PermanentOutboxError('Unsupported Season scoring topic');
      } catch (error) {
        recordFailure(event, dependencies.events);
        throw error;
      }
    },
  };
}

/** [BM-034] [DR-SCORE-07] Read one authorized House Season's ledger totals. */
export async function readSeasonStandings(
  request: ReadSeasonStandingsRequest,
  dependencies: ReadSeasonStandingsDependencies,
): Promise<SeasonStandings | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.scoring.readStandings(context, request.seasonId);
}
