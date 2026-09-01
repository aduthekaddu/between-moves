import {
  validateCharter,
  type HouseSeasonView,
  type NightRecurrence,
  type PointsRecipe,
  type SeasonState,
} from '@between-moves/domain';

export interface HouseSeasonRow {
  readonly id: unknown;
  readonly title: unknown;
  readonly state: unknown;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly charter_version: unknown;
  readonly correspondence_pace_hours: unknown;
  readonly night_recurrence: unknown;
  readonly points_recipe: unknown;
}

function isSeasonState(value: unknown): value is SeasonState {
  return value === 'draft' || value === 'active' || value === 'closing' || value === 'closed';
}

function parseDate(value: unknown, nullable: boolean): Date | null {
  if (value === null && nullable) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new Error('Invalid Season date');
  return value;
}

function parseRecurrence(value: unknown, pace: number): NightRecurrence {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Night recurrence');
  const candidate = value as Record<string, unknown>;
  const recurrence = {
    weekday: candidate.weekday,
    localTime: candidate.localTime,
    count: candidate.count,
  } as NightRecurrence;
  validateCharter({ correspondencePaceHours: pace, nightRecurrence: recurrence });
  return recurrence;
}

function parsePointsRecipe(value: unknown): PointsRecipe {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid MVP points recipe');
  const candidate = value as Record<string, unknown>;
  const caps = candidate.caps;
  if (typeof caps !== 'object' || caps === null) throw new Error('Invalid MVP points recipe');
  const values = [
    candidate.completedGame,
    candidate.win,
    candidate.draw,
    candidate.nightAttendance,
    candidate.publishedPuzzle,
    (caps as Record<string, unknown>).games,
    (caps as Record<string, unknown>).nights,
    (caps as Record<string, unknown>).puzzles,
  ];
  if (!values.every((entry) => Number.isInteger(entry) && (entry as number) >= 0)) {
    throw new Error('Invalid MVP points recipe');
  }
  return value as PointsRecipe;
}

/** Parse integrity-critical Season data before it reaches application/UI code. */
export function parseHouseSeasonRow(row: HouseSeasonRow): HouseSeasonView {
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || !isSeasonState(row.state)) {
    throw new Error('Invalid Season row');
  }
  const startsAt = parseDate(row.starts_at, true);
  const endsAt = parseDate(row.ends_at, true);
  if (row.charter_version === null) {
    return {
      seasonId: row.id,
      title: row.title,
      state: row.state,
      startsAt,
      endsAt,
      charter: null,
    };
  }
  if (!Number.isInteger(row.charter_version) || !Number.isInteger(row.correspondence_pace_hours)) {
    throw new Error('Invalid Charter row');
  }
  const pace = row.correspondence_pace_hours as number;
  return {
    seasonId: row.id,
    title: row.title,
    state: row.state,
    startsAt,
    endsAt,
    charter: {
      version: row.charter_version as number,
      correspondencePaceHours: pace,
      nightRecurrence: parseRecurrence(row.night_recurrence, pace),
      pointsRecipe: parsePointsRecipe(row.points_recipe),
    },
  };
}
