import type { HouseAuthorizationDenialRecorder } from '@between-moves/domain';
import type { HouseAuthorizationMetricStubs, StructuredLogger } from '@between-moves/observability';

export interface HouseAuthorizationDenialRecorderOptions {
  readonly logger: StructuredLogger;
  readonly metrics: HouseAuthorizationMetricStubs;
  readonly requestId: string;
}

/** [BM-012] Record each rejected House action without logging membership data. */
export function createHouseAuthorizationDenialRecorder(
  options: HouseAuthorizationDenialRecorderOptions,
): HouseAuthorizationDenialRecorder {
  return {
    record(denial) {
      options.metrics.incrementAuthorizationDenied(denial.crossHouse);
      options.logger.log({
        level: 'warn',
        requestId: options.requestId,
        actorId: denial.actorId,
        houseId: denial.houseId,
        gameId: null,
        commandId: null,
        event: 'house.authorization-denied',
        outcome: 'rejected',
        durationMs: 0,
        data: {
          action: denial.action,
          reason: denial.reason,
          cross_house: denial.crossHouse,
        },
      });
    },
  };
}
