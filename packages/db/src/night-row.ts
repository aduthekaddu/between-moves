import type { HouseNightView, NightRsvpStatus, NightState } from '@between-moves/domain';
import type { QueryResultRow } from 'pg';

export interface NightRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly season_id: unknown;
  readonly scheduled_start: unknown;
  readonly scheduled_end: unknown;
  readonly state: unknown;
  readonly host_membership_id?: unknown;
  readonly started_at?: unknown;
  readonly ended_at?: unknown;
  readonly viewer_is_host?: unknown;
  readonly viewer_rsvp?: unknown;
  readonly actor_membership_id?: unknown;
}

export function nightString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Night ${field}`);
  return value;
}

export function nightDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Night ${field}`);
  }
  return value;
}

function nullableDate(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : nightDate(value, field);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return nightString(value, field);
}

function stateValue(value: unknown): NightState {
  if (value === 'scheduled' || value === 'live' || value === 'ended' || value === 'cancelled') {
    return value;
  }
  throw new Error('Invalid Night state');
}

function rsvpValue(value: unknown): NightRsvpStatus | null {
  if (value === null || value === undefined) return null;
  if (value === 'going' || value === 'not_going') return value;
  throw new Error('Invalid Night RSVP');
}

export const nightViewColumns = `n.id::text, n.house_id::text, n.season_id::text,
  n.scheduled_start, n.scheduled_end, n.state, n.host_membership_id::text,
  n.started_at, n.ended_at, (n.host_membership_id is not distinct from m.id) as viewer_is_host,
  r.status as viewer_rsvp`;

export const nightRsvpJoin = `left join night_rsvps r
    on r.night_id = n.id and r.house_id = n.house_id and r.membership_id = m.id`;

export function parseNight(row: NightRow): HouseNightView {
  return {
    nightId: nightString(row.id, 'id'),
    houseId: nightString(row.house_id, 'House id'),
    seasonId: nightString(row.season_id, 'Season id'),
    scheduledStart: nightDate(row.scheduled_start, 'start'),
    scheduledEnd: nightDate(row.scheduled_end, 'end'),
    state: stateValue(row.state),
    hostMembershipId: nullableString(row.host_membership_id, 'host membership id'),
    startedAt: nullableDate(row.started_at, 'started at'),
    endedAt: nullableDate(row.ended_at, 'ended at'),
    viewerIsHost: row.viewer_is_host === true,
    viewerRsvp: rsvpValue(row.viewer_rsvp),
  };
}
