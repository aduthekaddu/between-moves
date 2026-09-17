import type { StructuredLogInput } from './logger';
import { createNightLifecycleRecorder } from './night-lifecycle-logger';
import { describe, expect, it, vi } from 'vitest';

describe('Night lifecycle observability', () => {
  it('[BM-035] emits PII-free Night start metadata', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createNightLifecycleRecorder({
      logger: { log },
      requestId: 'request-035',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      change: 'start',
      outcome: 'success',
    });

    expect(log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-035',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'night.started',
      outcome: 'success',
      durationMs: 0,
      data: {
        night_id: '01941f29-7c00-7000-8000-000000000901',
        change: 'start',
      },
    });
  });
});
