import type { StructuredLogInput } from './logger';
import { createNightJoinLeaveRecorder } from './night-join-leave-logger';
import { describe, expect, it, vi } from 'vitest';

describe('Night join/leave observability', () => {
  it('[BM-036] logs join and leave without presence or Member content', () => {
    const log = vi.fn<(input: StructuredLogInput) => void>();
    const recorder = createNightJoinLeaveRecorder({
      logger: { log },
      requestId: 'request-036',
    });

    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      attendanceId: '01941f29-7c00-7000-8000-000000000902',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      change: 'join',
      outcome: 'success',
    });
    recorder.record({
      actorId: '01941f29-7c00-7000-8000-000000000101',
      attendanceId: '01941f29-7c00-7000-8000-000000000902',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      nightId: '01941f29-7c00-7000-8000-000000000901',
      change: 'leave',
      outcome: 'success',
    });

    expect(log).toHaveBeenNthCalledWith(1, {
      level: 'info',
      requestId: 'request-036',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'night.joined',
      outcome: 'success',
      durationMs: 0,
      data: {
        attendance_id: '01941f29-7c00-7000-8000-000000000902',
        night_id: '01941f29-7c00-7000-8000-000000000901',
        change: 'join',
      },
    });
    expect(log).toHaveBeenNthCalledWith(2, {
      level: 'info',
      requestId: 'request-036',
      actorId: '01941f29-7c00-7000-8000-000000000101',
      houseId: '01941f29-7c00-7000-8000-000000000201',
      gameId: null,
      commandId: null,
      event: 'night.left',
      outcome: 'success',
      durationMs: 0,
      data: {
        attendance_id: '01941f29-7c00-7000-8000-000000000902',
        night_id: '01941f29-7c00-7000-8000-000000000901',
        change: 'leave',
      },
    });
  });
});
