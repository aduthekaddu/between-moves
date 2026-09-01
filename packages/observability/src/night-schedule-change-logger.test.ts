import type { StructuredLogInput } from './logger';
import { createNightScheduleChangeRecorder } from './night-schedule-change-logger';
import { describe, expect, it, vi } from 'vitest';

describe('Night schedule observability', () => {
  it('[BM-020] emits PII-free schedule-change metadata', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createNightScheduleChangeRecorder({
      logger: { log },
      requestId: 'request-020',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      change: 'rescheduled',
      outcome: 'success',
    });

    expect(log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-020',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'night.schedule-change',
      outcome: 'success',
      durationMs: 0,
      data: {
        night_id: '01941f29-7c00-7000-8000-000000000901',
        change: 'rescheduled',
      },
    });
  });
});
