import type { StructuredLogInput } from './logger';
import { createSeasonTransitionRecorder } from './season-transition-logger';
import { describe, expect, it, vi } from 'vitest';

describe('Season transition observability', () => {
  it('[BM-018] [DR-SEC-06] emits a metadata-only structured transition log', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createSeasonTransitionRecorder({
      logger: { log },
      requestId: 'request-018',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      seasonId: '01941f29-7c00-7000-8000-000000000301',
      event: 'publish_season',
      from: 'draft',
      to: 'active',
      outcome: 'success',
    });

    expect(log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-018',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'season.state-transition',
      outcome: 'success',
      durationMs: 0,
      data: {
        season_id: '01941f29-7c00-7000-8000-000000000301',
        transition: 'publish_season',
        from_state: 'draft',
        to_state: 'active',
      },
    });
  });

  it('[BM-018] records rejected transitions at warning level', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createSeasonTransitionRecorder({
      logger: { log },
      requestId: 'request-018',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      seasonId: '01941f29-7c00-7000-8000-000000000301',
      event: 'publish_season',
      from: 'draft',
      to: 'active',
      outcome: 'rejected',
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', outcome: 'rejected' }),
    );
  });
});
