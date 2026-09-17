import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { NightRow } from './night-row';
import { PgNightRepository } from './pg-night-repository';

const houseId = '01941f29-7c00-0000-0000-000000000201';
const nightId = '01941f29-7c00-0000-0000-000000000901';
const seasonId = '01941f29-7c00-0000-0000-000000000701';
const actorMembershipId = '01941f29-7c00-0000-0000-000000000601';
const auditId = '01941f29-7c00-0000-0000-000000000911';
const context = fakeAuthorizationContext({
  houseId,
  viewerId: '01941f29-7c00-0000-0000-000000000101',
});
const start = new Date('2026-09-04T14:00:00.000Z');
const end = new Date('2026-09-04T16:00:00.000Z');

function row(overrides: Partial<NightRow> = {}): NightRow {
  return {
    id: nightId,
    house_id: houseId,
    season_id: seasonId,
    scheduled_start: start,
    scheduled_end: end,
    state: 'scheduled',
    host_membership_id: null,
    started_at: null,
    ended_at: null,
    viewer_is_host: false,
    viewer_rsvp: null,
    actor_membership_id: actorMembershipId,
    ...overrides,
  };
}

function database(
  options: { readonly rows?: readonly NightRow[]; readonly auth?: NightRow[] } = {},
) {
  const listRows = options.rows ?? [row()];
  const authRows = options.auth ?? [row()];
  const clientQuery = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('for update of n')) return { rows: authRows, rowCount: authRows.length };
    if (sql.includes('update house_nights')) {
      return {
        rows: [
          row({
            scheduled_start: values[2],
            scheduled_end: values[3],
            state: values[4],
          }),
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('insert into night_audit')) return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled Night query: ${sql}`);
  });
  const poolQuery = vi.fn().mockResolvedValue({ rows: listRows, rowCount: listRows.length });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return {
    pool: { query: poolQuery, connect } as unknown as Pool,
    poolQuery,
    clientQuery,
    connect,
    release,
  };
}

describe('BM-020 PostgreSQL Night repository', () => {
  it('lists House-scoped Nights and maps RSVP and host state', async () => {
    const state = database({
      rows: [
        row({ host_membership_id: actorMembershipId, viewer_is_host: true, viewer_rsvp: 'going' }),
      ],
    });

    await expect(new PgNightRepository(state.pool).list(context)).resolves.toMatchObject([
      {
        nightId,
        houseId,
        hostMembershipId: actorMembershipId,
        viewerIsHost: true,
        viewerRsvp: 'going',
      },
    ]);
    expect(state.poolQuery).toHaveBeenCalledWith(expect.stringContaining('where n.house_id = $1'), [
      houseId,
      context.viewerId,
    ]);
  });

  it('reschedules a Night and writes an audit row atomically', async () => {
    const state = database();
    const changedAt = new Date('2026-09-03T12:00:00.000Z');
    const newStart = new Date('2026-09-05T14:00:00.000Z');
    const newEnd = new Date('2026-09-05T16:00:00.000Z');

    await expect(
      new PgNightRepository(state.pool).change(context, {
        nightId,
        auditId,
        changedAt,
        command: { kind: 'reschedule', scheduledStart: newStart, scheduledEnd: newEnd },
      }),
    ).resolves.toMatchObject({
      changedNow: true,
      night: { scheduledStart: newStart, scheduledEnd: newEnd },
    });
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into night_audit'),
      [
        auditId,
        houseId,
        nightId,
        actorMembershipId,
        'rescheduled',
        start,
        end,
        newStart,
        newEnd,
        changedAt,
      ],
    );
    expect(state.clientQuery).toHaveBeenCalledWith('commit');
  });

  it('handles idempotent cancellation and rejects unavailable or live Nights', async () => {
    const cancelled = database({ auth: [row({ state: 'cancelled' })] });
    await expect(
      new PgNightRepository(cancelled.pool).change(context, {
        nightId,
        auditId,
        changedAt: start,
        command: { kind: 'cancel' },
      }),
    ).resolves.toMatchObject({ changedNow: false, night: { state: 'cancelled' } });

    const unavailable = database({ auth: [] });
    await expect(
      new PgNightRepository(unavailable.pool).change(context, {
        nightId,
        auditId,
        changedAt: start,
        command: { kind: 'cancel' },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const live = database({ auth: [row({ state: 'live' })] });
    await expect(
      new PgNightRepository(live.pool).change(context, {
        nightId,
        auditId,
        changedAt: start,
        command: { kind: 'cancel' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('does not write a no-op reschedule and maps a unique conflict', async () => {
    const unchanged = database();
    await expect(
      new PgNightRepository(unchanged.pool).change(context, {
        nightId,
        auditId,
        changedAt: start,
        command: { kind: 'reschedule', scheduledStart: start, scheduledEnd: end },
      }),
    ).resolves.toMatchObject({ changedNow: false });
    expect(
      unchanged.clientQuery.mock.calls.some(([sql]) => sql.includes('update house_nights')),
    ).toBe(false);

    const duplicate = database();
    duplicate.clientQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));
    duplicate.clientQuery.mockImplementationOnce(async () => ({ rows: [row()], rowCount: 1 }));
    duplicate.clientQuery.mockImplementationOnce(async () => {
      const error = new Error('duplicate') as Error & { code: string };
      error.code = '23505';
      throw error;
    });
    await expect(
      new PgNightRepository(duplicate.pool).change(context, {
        nightId,
        auditId,
        changedAt: start,
        command: {
          kind: 'reschedule',
          scheduledStart: new Date(start.getTime() + 60_000),
          scheduledEnd: end,
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
