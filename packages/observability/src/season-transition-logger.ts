import type { StructuredLogger } from './logger';

type SeasonState = 'draft' | 'active' | 'closing' | 'closed';
type SeasonTransitionEvent =
  'draft_season' | 'publish_season' | 'close_season' | 'generation_complete';

interface SeasonTransitionObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly event: SeasonTransitionEvent;
  readonly from: SeasonState | null;
  readonly to: SeasonState;
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface SeasonTransitionRecorderOptions {
  readonly logger: StructuredLogger;
  readonly requestId: string;
}

/** [BM-018] [DR-SEC-06] Record PII-free Season transition metadata. */
export function createSeasonTransitionRecorder(options: SeasonTransitionRecorderOptions) {
  return {
    record(observation: SeasonTransitionObservation): void {
      options.logger.log({
        level: observation.outcome === 'success' ? 'info' : 'warn',
        requestId: options.requestId,
        actorId: observation.actorId,
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: 'season.state-transition',
        outcome: observation.outcome,
        durationMs: 0,
        data: {
          season_id: observation.seasonId,
          transition: observation.event,
          from_state: observation.from,
          to_state: observation.to,
        },
      });
    },
  };
}
