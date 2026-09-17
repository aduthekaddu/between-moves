import type { StructuredLogger } from './logger';

interface SeasonScoringEventObservation {
  readonly eventId: string;
  readonly houseId: string | null;
  readonly seasonId: string | null;
  readonly topic: string;
  readonly outcome: 'recorded' | 'capped' | 'duplicate' | 'failed';
  readonly ledgerEntryCount: number;
  readonly points: number;
}

export interface SeasonScoringEventRecorderOptions {
  readonly logger: StructuredLogger;
}

/** [BM-034] Record metadata-only scoring consumption and cap/idempotency outcomes. */
export function createSeasonScoringEventRecorder(options: SeasonScoringEventRecorderOptions) {
  return {
    record(observation: SeasonScoringEventObservation): void {
      options.logger.log({
        level: observation.outcome === 'failed' ? 'error' : 'info',
        requestId: observation.eventId,
        actorId: 'anonymous',
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: 'season.scoring-event-consumed',
        outcome: observation.outcome === 'failed' ? 'error' : 'success',
        durationMs: 0,
        data: {
          season_id: observation.seasonId,
          source_topic: observation.topic,
          scoring_outcome: observation.outcome,
          ledger_entry_count: observation.ledgerEntryCount,
          points: observation.points,
        },
      });
    },
  };
}
