import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgNightRsvpRepository } from './pg-night-rsvp-repository';

const houseId = '01941f29-7c00-8000-0000-000000000201';
const nightId = '01941f29-7c00-8000-0000-000000000901';
const membershipId = '01941f29-7c00-8000-0000-000000000601';
const rsvpId = '01941f29-7c00-8000-0000-000000000911';
const viewerId = '01941f29-7c00-8000-0000-000000000101';
const respondedAt = new Date('2026-09-04T12:00:00.000Z');
const context = fakeAuthorizationContext({ houseId, viewerId });

interface RsvpDatabaseOptions {
  readonly authorized?: boolean;
  readonly row?: Record<string, unknown>;
}

function database(options: RsvpDatabaseOptions = {}) {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('for share of n, m')) {
      return options.authorized === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ membership_id: membershipId }], rowCount: 1 };
    }
    if (sql.includes('insert into night_rsvps')) {
      return {
        rows: [
          options.row ?? {
            id: rsvpId,
            house_id: houseId,
            night_id: nightId,
            membership_id: membershipId,
            status: 'going',
            responded_at: respondedAt,
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unhandled RSVP query: ${sql}`);
  });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return {
    pool: { connect } as unknown as Pool,
    clientQuery,
    connect,
    release,
  };
}

describe('BM-035 PostgreSQL Night RSVP repository', () => {
  it('upserts a House-scoped RSVP and maps the saved row', async () => {
    const state = database();

    await expect(
      new PgNightRsvpRepository(state.pool).rsvp(context, {
        rsvpId,
        nightId,
        status: 'going',
        respondedAt,
      }),
    ).resolves.toEqual({
      rsvpId,
      houseId,
      nightId,
      membershipId,
      status: 'going',
      respondedAt,
    });
    expect(state.clientQuery).toHaveBeenCalledWith('begin');
    expect(state.clientQuery).toHaveBeenCalledWith('commit');
    expect(state.release).toHaveBeenCalledOnce();
  });

  it('rejects invalid status before opening a transaction', async () => {
    const state = database();

    await expect(
      new PgNightRsvpRepository(state.pool).rsvp(context, {
        rsvpId,
        nightId,
        status: 'maybe' as never,
        respondedAt,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(state.connect).not.toHaveBeenCalled();
  });

  it('hides an unavailable Night and rolls back the transaction', async () => {
    const state = database({ authorized: false });

    await expect(
      new PgNightRsvpRepository(state.pool).rsvp(context, {
        rsvpId,
        nightId,
        status: 'not_going',
        respondedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(state.clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('rejects malformed persisted RSVP rows', async () => {
    const state = database({ row: { id: rsvpId, house_id: houseId, night_id: nightId } });

    await expect(
      new PgNightRsvpRepository(state.pool).rsvp(context, {
        rsvpId,
        nightId,
        status: 'going',
        respondedAt,
      }),
    ).rejects.toThrow('Invalid Night');
    expect(state.clientQuery).toHaveBeenCalledWith('rollback');
  });
});
