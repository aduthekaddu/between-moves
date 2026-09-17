import type { StructuredLogInput } from './logger';
import { createNightAttendanceEventRecorder } from './night-attendance-event-logger';
import { describe, expect, it, vi } from 'vitest';

describe('Night attendance observability', () => {
  it('[BM-033] logs the attendance scoring event without presence data', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createNightAttendanceEventRecorder({
      logger: { log },
      requestId: 'request-033',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      attendanceId: '01941f29-7c00-7000-8000-000000000902',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      sourceKey: 'night:01941f29-7c00-7000-8000-000000000901',
    });

    expect(log).toHaveBeenCalledWith({
      level: 'info',
      requestId: 'request-033',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'night.attendance-qualified',
      outcome: 'success',
      durationMs: 0,
      data: {
        attendance_id: '01941f29-7c00-7000-8000-000000000902',
        night_id: '01941f29-7c00-7000-8000-000000000901',
        source_key: 'night:01941f29-7c00-7000-8000-000000000901',
      },
    });
  });
});
