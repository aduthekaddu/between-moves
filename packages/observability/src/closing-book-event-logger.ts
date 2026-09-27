import type { StructuredLogger } from './logger';

interface ClosingBookObservation {
  readonly eventId: string;
  readonly houseId: string | null;
  readonly seasonId: string | null;
  readonly bookId: string | null;
  readonly outcome: 'published' | 'duplicate' | 'failed';
  readonly generationVersion: number;
}

export interface ClosingBookEventRecorderOptions {
  readonly logger: StructuredLogger;
}

/** [BM-048] Record Closing Book generation and publication without any of its contents. */
export function createClosingBookEventRecorder(options: ClosingBookEventRecorderOptions) {
  return {
    /** Log one generation outcome as `closing_book.generation`. */
    record(observation: ClosingBookObservation): void {
      const failed = observation.outcome === 'failed';
      options.logger.log({
        level: failed ? 'error' : 'info',
        requestId: observation.eventId,
        actorId: 'anonymous',
        houseId: observation.houseId,
        gameId: null,
        commandId: null,
        event: 'closing_book.generation',
        outcome: failed ? 'error' : 'success',
        durationMs: 0,
        data: {
          season_id: observation.seasonId,
          closing_book_id: observation.bookId,
          closing_book_outcome: observation.outcome,
          generation_version: observation.generationVersion,
        },
      });
    },
  };
}
