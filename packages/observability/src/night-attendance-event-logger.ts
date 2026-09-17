import type { StructuredLogger } from './logger';

interface NightAttendanceEventObservation {
  readonly actorId: string;
  readonly attendanceId: string;
  readonly houseId: string;
  readonly nightId: string;
  readonly sourceKey: string;
}

export interface NightAttendanceEventRecorderOptions {
  readonly logger: StructuredLogger;
  readonly requestId: string;
}

/** [BM-033] Record metadata-only attendance scoring-source emission. */
export function createNightAttendanceEventRecorder(options: NightAttendanceEventRecorderOptions) {
  return {
    record(observation: NightAttendanceEventObservation): void {
      options.logger.log({
        level: 'info',
        requestId: options.requestId,
        actorId: observation.actorId,
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: 'night.attendance-qualified',
        outcome: 'success',
        durationMs: 0,
        data: {
          attendance_id: observation.attendanceId,
          night_id: observation.nightId,
          source_key: observation.sourceKey,
        },
      });
    },
  };
}
