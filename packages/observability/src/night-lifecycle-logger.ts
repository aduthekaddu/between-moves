import type { StructuredLogger } from './logger';

interface NightLifecycleObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: 'start' | 'end';
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightLifecycleRecorderOptions {
  readonly logger: StructuredLogger;
  readonly requestId: string;
}

/** [BM-035] Record metadata-only Night start and end outcomes. */
export function createNightLifecycleRecorder(options: NightLifecycleRecorderOptions) {
  return {
    record(observation: NightLifecycleObservation): void {
      options.logger.log({
        level: observation.outcome === 'success' ? 'info' : 'warn',
        requestId: options.requestId,
        actorId: observation.actorId,
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: observation.change === 'start' ? 'night.started' : 'night.ended',
        outcome: observation.outcome,
        durationMs: 0,
        data: { night_id: observation.nightId, change: observation.change },
      });
    },
  };
}
