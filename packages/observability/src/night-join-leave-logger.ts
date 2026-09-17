import type { StructuredLogger } from './logger';

interface NightJoinLeaveObservation {
  readonly actorId: string;
  readonly attendanceId: string | null;
  readonly houseId: string;
  readonly nightId: string;
  readonly change: 'join' | 'leave';
  readonly outcome: 'success' | 'rejected' | 'error';
}

export interface NightJoinLeaveRecorderOptions {
  readonly logger: StructuredLogger;
  readonly requestId: string;
}

/** [BM-036] Record metadata-only Night join and leave outcomes. */
export function createNightJoinLeaveRecorder(options: NightJoinLeaveRecorderOptions) {
  return {
    record(observation: NightJoinLeaveObservation): void {
      options.logger.log({
        level: observation.outcome === 'success' ? 'info' : 'warn',
        requestId: options.requestId,
        actorId: observation.actorId,
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: observation.change === 'join' ? 'night.joined' : 'night.left',
        outcome: observation.outcome,
        durationMs: 0,
        data: {
          attendance_id: observation.attendanceId,
          night_id: observation.nightId,
          change: observation.change,
        },
      });
    },
  };
}
