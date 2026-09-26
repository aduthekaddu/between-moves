import { describe, expect, it } from 'vitest';
import {
  transitionSeasonState,
  validateCharter,
  validateSeasonTitle,
  validateSeasonWindow,
  type SeasonState,
  type SeasonTransitionEvent,
} from './index';

describe('Season state machine', () => {
  it.each([
    [null, 'draft_season', 'draft'],
    ['draft', 'publish_season', 'active'],
    ['active', 'close_season', 'closing'],
    ['closing', 'finalize_season', 'closed'],
  ] as const)('[BM-018] [DR-SEASON-04..07] transitions %s through %s to %s', (from, event, to) => {
    expect(transitionSeasonState(from, event)).toBe(to);
  });

  it('[BM-018] [DR-SEASON-04..07] rejects every edge outside the transition graph', () => {
    const states = [null, 'draft', 'active', 'closing', 'closed'] as const;
    const events = ['draft_season', 'publish_season', 'close_season', 'finalize_season'] as const;
    const allowed = new Set([
      'none:draft_season',
      'draft:publish_season',
      'active:close_season',
      'closing:finalize_season',
    ]);

    for (const state of states) {
      for (const event of events) {
        if (allowed.has(`${state ?? 'none'}:${event}`)) continue;
        expect(() =>
          transitionSeasonState(state as SeasonState | null, event as SeasonTransitionEvent),
        ).toThrow(expect.objectContaining({ code: 'conflict' }));
      }
    }
  });
});

describe('Charter validation', () => {
  it('[BM-018] [DR-SEASON-01..03] accepts the exact four-week Charter shape', () => {
    expect(validateSeasonTitle('  Autumn tables  ')).toBe('Autumn tables');
    expect(() =>
      validateCharter({
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      }),
    ).not.toThrow();
    expect(() =>
      validateSeasonWindow(
        new Date('2026-09-04T12:00:00.000Z'),
        new Date('2026-10-02T12:00:00.000Z'),
      ),
    ).not.toThrow();
  });

  it.each([
    [{ correspondencePaceHours: 0, nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 } }],
    [
      {
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 7, localTime: '19:30', count: 4 },
      },
    ],
    [
      {
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '25:00', count: 4 },
      },
    ],
    [
      {
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 3 },
      },
    ],
  ] as const)('[BM-018] rejects an invalid Charter %#', (input) => {
    expect(() => validateCharter(input as never)).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('[BM-018] rejects a Season window shorter than four weeks', () => {
    expect(() =>
      validateSeasonWindow(
        new Date('2026-09-04T12:00:00.000Z'),
        new Date('2026-10-01T12:00:00.000Z'),
      ),
    ).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  });

  it.each([Number.NaN, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY])(
    '[BM-019] [DR-SEASON-02] rejects non-integer correspondence pace %s',
    (correspondencePaceHours) => {
      expect(() =>
        validateCharter({
          correspondencePaceHours,
          nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
        }),
      ).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    },
  );

  it.each(['7:30', '19:3', '19:30Z', ' 19:30 '])(
    '[BM-019] [DR-SEASON-03] rejects non-canonical Night time %s',
    (localTime) => {
      expect(() =>
        validateCharter({
          correspondencePaceHours: 24,
          nightRecurrence: { weekday: 5, localTime, count: 4 },
        }),
      ).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    },
  );
});
