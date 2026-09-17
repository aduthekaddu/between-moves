import { describe, expect, it } from 'vitest';
import { createStructuredLogger } from './logger';
import { createSeasonScoringEventRecorder } from './season-scoring-event-logger';

describe('Season scoring event observability', () => {
  it('[BM-034] logs scoring outcome and totals without Member details', () => {
    const lines: string[] = [];
    const recorder = createSeasonScoringEventRecorder({
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-09-12T12:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
    });

    recorder.record({
      eventId: '01941f29-7c00-7000-8000-000000000801',
      houseId: '01941f29-7c00-7000-8000-000000000601',
      seasonId: '01941f29-7c00-7000-8000-000000000691',
      topic: 'game.completed',
      outcome: 'recorded',
      ledgerEntryCount: 2,
      points: 4,
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      request_id: '01941f29-7c00-7000-8000-000000000801',
      actor_id: 'anonymous',
      house_id: '01941f29-7c00-7000-8000-000000000601',
      event: 'season.scoring-event-consumed',
      outcome: 'success',
      data: {
        season_id: '01941f29-7c00-7000-8000-000000000691',
        source_topic: 'game.completed',
        scoring_outcome: 'recorded',
        ledger_entry_count: 2,
        points: 4,
      },
    });
    expect(lines[0]).not.toContain('membership');
  });

  it('[BM-034] logs failed scoring attempts without source payload data', () => {
    const lines: string[] = [];
    const recorder = createSeasonScoringEventRecorder({
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-09-12T12:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
    });

    recorder.record({
      eventId: '01941f29-7c00-7000-8000-000000000802',
      houseId: null,
      seasonId: null,
      topic: 'puzzle.published',
      outcome: 'failed',
      ledgerEntryCount: 0,
      points: 0,
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'error',
      house_id: null,
      event: 'season.scoring-event-consumed',
      outcome: 'error',
      data: { season_id: null, source_topic: 'puzzle.published', scoring_outcome: 'failed' },
    });
  });
});
