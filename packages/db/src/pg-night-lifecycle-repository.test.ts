import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { NightRow } from './night-row';
import { PgNightLifecycleRepository } from './pg-night-lifecycle-repository';

const houseId = '01941f29-7c00-8000-0000-000000000201';
const nightId = '01941f29-7c00-8000-0000-000000000901';
const seasonId = '01941f29-7c00-8000-0000-000000000701';
const viewerId = '01941f29-7c00-8000-0000-000000000101';
const membershipId = '01941f29-7c00-8000-0000-000000000601';
const hostMembershipId = '01941f29-7c00-8000-0000-000000000603';
const eventId = '01941f29-7c00-8000-0000-000000000911';
const at = new Date('2026-09-04T14:00:00.000Z');
const context = fakeAuthorizationContext({ houseId, viewerId });

function row(overrides: Partial<NightRow> = {}): NightRow {
  return {
    id: nightId,
    house_id: houseId,
    season_id: seasonId,
    scheduled_start: at,
    scheduled_end: new Date('2026-09-04T16:00:00.000Z'),
    state: 'scheduled',
    host_membership_id: null,
    started_at: null,
    ended_at: null,
    viewer_is_host: false,
    viewer_rsvp: null,
    actor_membership_id: membershipId,
    ...overrides,
  };
}

interface LifecycleDatabaseOptions {
  readonly authorizedRow?: NightRow;
  readonly hostExists?: boolean;
  readonly candidateRows?: readonly { membership_id: unknown; display_name: unknown }[];
  readonly assigned?: boolean;
}

function database(options: LifecycleDatabaseOptions = {}) {
  const authorizedRow = options.authorizedRow ?? row();
  const clientQuery = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('from house_nights') && sql.includes('for update of n')) {
      return { rows: [authorizedRow], rowCount: 1 };
    }
    if (sql.includes('select id::text') && sql.includes('from memberships')) {
      return {
        rows: options.hostExists === false ? [] : [{ id: values[0] }],
        rowCount: options.hostExists === false ? 0 : 1,
      };
    }
    if (sql.includes('update house_nights') && sql.includes('set state')) {
      return {
        rows: [
          row({
            state: values[2],
            host_membership_id: authorizedRow.host_membership_id ?? null,
            started_at: values[3] ?? null,
            ended_at: values[4] ?? null,
          }),
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('update house_nights') && sql.includes('set host_membership_id')) {
      return {
        rows: [row({ host_membership_id: values[2] })],
        rowCount: 1,
      };
    }
    if (sql.includes('insert into outbox_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled lifecycle query: ${sql}`);
  });
  const poolQuery = vi.fn(async (sql: string) => {
    if (sql.includes('select m.id::text as membership_id')) {
      return { rows: options.candidateRows ?? [], rowCount: options.candidateRows?.length ?? 0 };
    }
    return { rows: options.assigned ? [{}] : [], rowCount: options.assigned ? 1 : 0 };
  });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect, query: poolQuery } as unknown as Pool;
  return { pool, clientQuery, poolQuery, connect, release };
}

describe('BM-035 PostgreSQL Night lifecycle repository', () => {
  it('starts a scheduled Night, timestamps it, and emits one outbox event', async () => {
    const databaseState = database();

    await expect(
      new PgNightLifecycleRepository(databaseState.pool).start(context, {
        nightId,
        eventId,
        at,
      }),
    ).resolves.toMatchObject({
      night: { state: 'live', startedAt: at },
      changedNow: true,
    });
    expect(databaseState.clientQuery).toHaveBeenCalledWith('begin');
    expect(databaseState.clientQuery).toHaveBeenCalledWith('commit');
    expect(databaseState.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into outbox_events'),
      expect.any(Array),
    );
    expect(databaseState.release).toHaveBeenCalledOnce();
  });

  it('treats a repeated start as an idempotent no-op', async () => {
    const databaseState = database({ authorizedRow: row({ state: 'live', started_at: at }) });

    await expect(
      new PgNightLifecycleRepository(databaseState.pool).start(context, {
        nightId,
        eventId,
        at: new Date(at.getTime() + 60_000),
      }),
    ).resolves.toMatchObject({ changedNow: false, night: { state: 'live', startedAt: at } });
    expect(
      databaseState.clientQuery.mock.calls.some(([sql]) =>
        sql.includes('insert into outbox_events'),
      ),
    ).toBe(false);
  });

  it('ends a live Night and rejects invalid lifecycle transitions', async () => {
    const ended = await new PgNightLifecycleRepository(
      database({ authorizedRow: row({ state: 'live' }) }).pool,
    ).end(context, { nightId, eventId, at });
    expect(ended).toMatchObject({ changedNow: true, night: { state: 'ended', endedAt: at } });

    const cancelled = database({ authorizedRow: row({ state: 'cancelled' }) });
    await expect(
      new PgNightLifecycleRepository(cancelled.pool).start(context, { nightId, eventId, at }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(cancelled.clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('assigns a temporary host, preserves idempotency, and validates the candidate', async () => {
    const databaseState = database();
    await expect(
      new PgNightLifecycleRepository(databaseState.pool).assignHost(context, {
        nightId,
        hostMembershipId,
        assignedAt: at,
      }),
    ).resolves.toMatchObject({
      changedNow: true,
      night: { hostMembershipId },
    });

    const unchanged = database({ authorizedRow: row({ host_membership_id: hostMembershipId }) });
    await expect(
      new PgNightLifecycleRepository(unchanged.pool).assignHost(context, {
        nightId,
        hostMembershipId,
        assignedAt: at,
      }),
    ).resolves.toMatchObject({ changedNow: false, night: { hostMembershipId } });

    const missingHost = database({ hostExists: false });
    await expect(
      new PgNightLifecycleRepository(missingHost.pool).assignHost(context, {
        nightId,
        hostMembershipId,
        assignedAt: at,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(missingHost.clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('does not assign a host to an ended Night and lists scoped candidates', async () => {
    const ended = database({ authorizedRow: row({ state: 'ended' }) });
    await expect(
      new PgNightLifecycleRepository(ended.pool).assignHost(context, {
        nightId,
        hostMembershipId,
        assignedAt: at,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const candidates = database({
      candidateRows: [{ membership_id: hostMembershipId, display_name: 'Bea' }],
    });
    await expect(
      new PgNightLifecycleRepository(candidates.pool).listHostCandidates(context),
    ).resolves.toEqual([{ membershipId: hostMembershipId, displayName: 'Bea' }]);
    expect(candidates.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('where m.house_id = $1'),
      [houseId, viewerId],
    );
  });

  it('checks host duty for each lifecycle operation', async () => {
    const assigned = database({ assigned: true });
    const repository = new PgNightLifecycleRepository(assigned.pool);

    await expect(
      repository.isAssignedNightHost({ houseId, nightId, membershipId, operation: 'start' }),
    ).resolves.toBe(true);
    await expect(
      repository.isAssignedNightHost({ houseId, nightId, membershipId, operation: 'end' }),
    ).resolves.toBe(true);

    const notAssigned = database();
    await expect(
      new PgNightLifecycleRepository(notAssigned.pool).isAssignedNightHost({
        houseId,
        nightId,
        membershipId,
      }),
    ).resolves.toBe(false);
  });
});
