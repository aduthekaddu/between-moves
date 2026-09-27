import { describe, expect, it } from 'vitest';
import { createClosingBookEventRecorder } from './closing-book-event-logger';
import { createStructuredLogger } from './logger';

/** A recorder whose structured log lines are collected into `lines`. */
function recorder(lines: string[]) {
  return createClosingBookEventRecorder({
    logger: createStructuredLogger({
      clock: { now: () => new Date('2026-10-02T13:00:05.000Z') },
      sink: (line) => lines.push(line),
    }),
  });
}

describe('Closing Book generation observability', () => {
  it('[BM-048] logs publication metadata without the book’s contents', () => {
    const lines: string[] = [];

    recorder(lines).record({
      eventId: '01941f29-7c00-7000-8000-000000004711',
      houseId: '01941f29-7c00-7000-8000-000000000601',
      seasonId: '01941f29-7c00-7000-8000-000000004701',
      bookId: '01941f29-7c00-7000-8000-000000004801',
      outcome: 'published',
      generationVersion: 1,
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'info',
      request_id: '01941f29-7c00-7000-8000-000000004711',
      actor_id: 'anonymous',
      house_id: '01941f29-7c00-7000-8000-000000000601',
      event: 'closing_book.generation',
      outcome: 'success',
      data: {
        season_id: '01941f29-7c00-7000-8000-000000004701',
        closing_book_id: '01941f29-7c00-7000-8000-000000004801',
        closing_book_outcome: 'published',
        generation_version: 1,
      },
    });
  });

  it('[BM-048] logs a failed generation as an error', () => {
    const lines: string[] = [];

    recorder(lines).record({
      eventId: '01941f29-7c00-7000-8000-000000004711',
      houseId: null,
      seasonId: null,
      bookId: null,
      outcome: 'failed',
      generationVersion: 1,
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'error',
      outcome: 'error',
      data: { closing_book_outcome: 'failed', closing_book_id: null },
    });
  });
});
