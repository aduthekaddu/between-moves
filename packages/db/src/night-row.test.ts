import { describe, expect, it } from 'vitest';
import { nightDate, nightString, parseNight, type NightRow } from './night-row';

const nightId = '01941f29-7c00-7000-8000-000000000901';
const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const hostMembershipId = '01941f29-7c00-7000-8000-000000000601';
const scheduledStart = new Date('2026-09-04T14:00:00.000Z');
const scheduledEnd = new Date('2026-09-04T16:00:00.000Z');

function row(overrides: Partial<NightRow> = {}): NightRow {
  return {
    id: nightId,
    house_id: houseId,
    season_id: seasonId,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    state: 'scheduled',
    host_membership_id: null,
    started_at: null,
    ended_at: null,
    viewer_is_host: false,
    viewer_rsvp: null,
    ...overrides,
  };
}

describe('Night row mapping', () => {
  it('[BM-035] maps lifecycle, host, and RSVP fields', () => {
    const startedAt = new Date('2026-09-04T14:01:00.000Z');
    const endedAt = new Date('2026-09-04T16:01:00.000Z');

    expect(
      parseNight(
        row({
          state: 'ended',
          host_membership_id: hostMembershipId,
          started_at: startedAt,
          ended_at: endedAt,
          viewer_is_host: true,
          viewer_rsvp: 'going',
        }),
      ),
    ).toEqual({
      nightId,
      houseId,
      seasonId,
      scheduledStart,
      scheduledEnd,
      state: 'ended',
      hostMembershipId,
      startedAt,
      endedAt,
      viewerIsHost: true,
      viewerRsvp: 'going',
    });
  });

  it('[BM-035] accepts nullable values returned by left joins', () => {
    expect(parseNight(row({ viewer_is_host: false, viewer_rsvp: undefined }))).toMatchObject({
      hostMembershipId: null,
      startedAt: null,
      endedAt: null,
      viewerRsvp: null,
    });
  });

  it('rejects malformed scalar Night fields', () => {
    expect(() => nightString(42, 'id')).toThrow('Invalid Night id');
    expect(() => nightDate('2026-09-04T14:00:00.000Z', 'start')).toThrow('Invalid Night start');
    expect(() => nightDate(new Date('invalid'), 'start')).toThrow('Invalid Night start');
    expect(() => parseNight(row({ state: 'paused' }))).toThrow('Invalid Night state');
    expect(() => parseNight(row({ viewer_rsvp: 'maybe' }))).toThrow('Invalid Night RSVP');
    expect(() => parseNight(row({ scheduled_start: 'invalid' }))).toThrow('Invalid Night start');
    expect(() => parseNight(row({ host_membership_id: 42 }))).toThrow(
      'Invalid Night host membership id',
    );
  });
});
