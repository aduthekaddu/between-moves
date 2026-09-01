import type { StructuredLogger } from './logger';

interface NightScheduleChangeObservation {
  readonly actorId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: 'rescheduled' | 'cancelled';
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightScheduleChangeRecorderOptions {
  readonly logger: StructuredLogger;
  readonly requestId: string;
}

/** [BM-020] Record metadata-only Night reschedule and cancellation outcomes. */
export function createNightScheduleChangeRecorder(options: NightScheduleChangeRecorderOptions) {
  return {
    record(observation: NightScheduleChangeObservation): void {
      options.logger.log({
        level: observation.outcome === 'success' ? 'info' : 'warn',
        requestId: options.requestId,
        actorId: observation.actorId,
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: 'night.schedule-change',
        outcome: observation.outcome,
        durationMs: 0,
        data: { night_id: observation.nightId, change: observation.change },
      });
    },
  };
}
