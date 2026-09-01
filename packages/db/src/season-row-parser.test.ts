import { describe, expect, it } from 'vitest';
import { parseHouseSeasonRow } from './season-row-parser';

const pointsRecipe = {
  caps: { games: 8, nights: 4, puzzles: 2 },
  draw: 1,
  completedGame: 1,
  publishedPuzzle: 1,
  nightAttendance: 1,
  win: 2,
};

describe('Season row parser', () => {
  it('[BM-019] parses a PostgreSQL JSONB Charter regardless of key order', () => {
    expect(
      parseHouseSeasonRow({
        id: '01941f29-7c00-7000-8000-000000000701',
        title: 'Autumn tables',
        state: 'active',
        starts_at: new Date('2026-09-04T00:00:00.000Z'),
        ends_at: new Date('2026-10-02T00:00:00.000Z'),
        charter_version: 1,
        correspondence_pace_hours: 24,
        night_recurrence: { count: 4, localTime: '19:30', weekday: 5 },
        points_recipe: pointsRecipe,
      }),
    ).toMatchObject({
      state: 'active',
      charter: { version: 1, correspondencePaceHours: 24, pointsRecipe },
    });
  });

  it('[BM-019] preserves a structurally valid historical points snapshot', () => {
    const historical = { ...pointsRecipe, win: 3 };
    expect(
      parseHouseSeasonRow({
        id: '01941f29-7c00-7000-8000-000000000701',
        title: 'Autumn tables',
        state: 'active',
        starts_at: new Date('2026-09-04T00:00:00.000Z'),
        ends_at: new Date('2026-10-02T00:00:00.000Z'),
        charter_version: 1,
        correspondence_pace_hours: 24,
        night_recurrence: { count: 4, localTime: '19:30', weekday: 5 },
        points_recipe: historical,
      }),
    ).toMatchObject({ charter: { pointsRecipe: historical } });
  });

  it('[BM-019] rejects a malformed points snapshot', () => {
    expect(() =>
      parseHouseSeasonRow({
        id: '01941f29-7c00-7000-8000-000000000701',
        title: 'Autumn tables',
        state: 'active',
        starts_at: new Date('2026-09-04T00:00:00.000Z'),
        ends_at: new Date('2026-10-02T00:00:00.000Z'),
        charter_version: 1,
        correspondence_pace_hours: 24,
        night_recurrence: { count: 4, localTime: '19:30', weekday: 5 },
        points_recipe: { ...pointsRecipe, win: -1 },
      }),
    ).toThrow('Invalid MVP points recipe');
  });
});
