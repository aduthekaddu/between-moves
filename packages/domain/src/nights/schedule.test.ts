import { describe, expect, it } from 'vitest';
import { houseLocalDateTimeToInstant, materializeNightSchedule } from './schedule';

const ids = [
  '01941f29-7c00-7000-8000-000000000901',
  '01941f29-7c00-7000-8000-000000000902',
  '01941f29-7c00-7000-8000-000000000903',
  '01941f29-7c00-7000-8000-000000000904',
] as const;

describe('Between Moves Night schedule materialization', () => {
  it('[BM-020] [DR-SEASON-03] creates four weekly House-local intervals', () => {
    const schedule = materializeNightSchedule({
      ids,
      seasonStartsAt: new Date('2026-09-04T00:00:00.000Z'),
      seasonEndsAt: new Date('2026-10-02T00:00:00.000Z'),
      recurrence: { weekday: 5, localTime: '19:30', count: 4 },
      timeZone: 'Asia/Kolkata',
    });

    expect(schedule.map((night) => night.scheduledStart.toISOString())).toEqual([
      '2026-09-04T14:00:00.000Z',
      '2026-09-11T14:00:00.000Z',
      '2026-09-18T14:00:00.000Z',
      '2026-09-25T14:00:00.000Z',
    ]);
    expect(
      schedule.every(
        (night) => night.scheduledEnd.getTime() - night.scheduledStart.getTime() === 7_200_000,
      ),
    ).toBe(true);
  });

  it('[BM-020] preserves the local wall time across a daylight-saving transition', () => {
    const schedule = materializeNightSchedule({
      ids,
      seasonStartsAt: new Date('2026-10-23T00:00:00.000Z'),
      seasonEndsAt: new Date('2026-11-20T00:00:00.000Z'),
      recurrence: { weekday: 0, localTime: '19:30', count: 4 },
      timeZone: 'America/Toronto',
    });

    expect(schedule.map((night) => night.scheduledStart.toISOString())).toEqual([
      '2026-10-25T23:30:00.000Z',
      '2026-11-02T00:30:00.000Z',
      '2026-11-09T00:30:00.000Z',
      '2026-11-16T00:30:00.000Z',
    ]);
  });

  it('[BM-020] still creates four local weeks when fall-back moves the last UTC instant past the absolute Season end', () => {
    const schedule = materializeNightSchedule({
      ids,
      seasonStartsAt: new Date('2026-10-25T00:00:00.000Z'),
      seasonEndsAt: new Date('2026-11-22T00:00:00.000Z'),
      recurrence: { weekday: 6, localTime: '19:30', count: 4 },
      timeZone: 'America/Toronto',
    });

    expect(schedule.map((night) => night.scheduledStart.toISOString())).toEqual([
      '2026-10-31T23:30:00.000Z',
      '2026-11-08T00:30:00.000Z',
      '2026-11-15T00:30:00.000Z',
      '2026-11-22T00:30:00.000Z',
    ]);
  });

  it('[BM-020] resolves a House-local reschedule minute to UTC', () => {
    expect(houseLocalDateTimeToInstant('2026-11-07T19:30', 'America/Toronto').toISOString()).toBe(
      '2026-11-08T00:30:00.000Z',
    );
  });
});
