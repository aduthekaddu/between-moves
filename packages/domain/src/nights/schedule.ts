import type { NightRecurrence } from '../seasons';
import { DomainError } from '../shared/errors';

export const DEFAULT_NIGHT_DURATION_MS = 2 * 60 * 60 * 1_000;

export interface MaterializedNight {
  readonly nightId: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
}

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function zonedParts(instant: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function offsetAt(instantMs: number, timeZone: string): number {
  const parts = zonedParts(new Date(instantMs), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instantMs;
}

function wallClockInstant(parts: CalendarParts, timeZone: string): Date {
  const wallClockMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let instantMs = wallClockMs - offsetAt(wallClockMs, timeZone);
  instantMs = wallClockMs - offsetAt(instantMs, timeZone);
  const instant = new Date(instantMs);
  const resolved = zonedParts(instant, timeZone);
  if (
    Object.keys(parts).some(
      (key) => resolved[key as keyof CalendarParts] !== parts[key as keyof CalendarParts],
    )
  ) {
    throw new DomainError('validation_failed', 'Night recurrence falls on an invalid local time');
  }
  return instant;
}

/** [BM-020] Resolve one House-local minute to its UTC instant. */
export function houseLocalDateTimeToInstant(localDateTime: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (match === null) {
    throw new DomainError('validation_failed', 'Night date and time are invalid');
  }
  const [, year, month, day, hour, minute] = match;
  return wallClockInstant(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
    },
    timeZone,
  );
}

function addCalendarDays(
  input: Pick<CalendarParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<CalendarParts, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(input.year, input.month - 1, input.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** [BM-020] [DR-SEASON-03] Expand a four-week House-local recurrence into UTC intervals. */
export function materializeNightSchedule(input: {
  readonly ids: readonly [string, string, string, string];
  readonly seasonStartsAt: Date;
  readonly seasonEndsAt: Date;
  readonly recurrence: NightRecurrence;
  readonly timeZone: string;
}): readonly MaterializedNight[] {
  const localStart = zonedParts(input.seasonStartsAt, input.timeZone);
  const localStartDay = new Date(
    Date.UTC(localStart.year, localStart.month - 1, localStart.day),
  ).getUTCDay();
  let firstDate = addCalendarDays(localStart, (input.recurrence.weekday - localStartDay + 7) % 7);
  const [hour, minute] = input.recurrence.localTime.split(':').map(Number) as [number, number];
  let firstStart = wallClockInstant({ ...firstDate, hour, minute }, input.timeZone);
  if (firstStart < input.seasonStartsAt) {
    firstDate = addCalendarDays(firstDate, 7);
    firstStart = wallClockInstant({ ...firstDate, hour, minute }, input.timeZone);
  }

  const schedule = input.ids.map((nightId, index) => {
    const date = addCalendarDays(firstDate, index * 7);
    const scheduledStart =
      index === 0 ? firstStart : wallClockInstant({ ...date, hour, minute }, input.timeZone);
    return {
      nightId,
      scheduledStart,
      scheduledEnd: new Date(scheduledStart.getTime() + DEFAULT_NIGHT_DURATION_MS),
    };
  });
  if (
    new Set(input.ids).size !== input.ids.length ||
    schedule.some((night) => night.nightId.length === 0)
  ) {
    throw new DomainError('validation_failed', 'Charter recurrence must produce four Nights');
  }
  return schedule;
}
