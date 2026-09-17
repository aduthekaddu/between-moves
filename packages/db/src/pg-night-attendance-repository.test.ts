import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgNightAttendanceRepository } from './pg-night-attendance-repository';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const viewerId = '01941f29-7c00-7000-8000-000000000101';
const membershipId = '01941f29-7c00-7000-8000-000000000601';
const attendanceId = '01941f29-7c00-7000-8000-000000000902';
const joinEventId = '01941f29-7c00-7000-8000-000000000904';
const leaveEventId = '01941f29-7c00-7000-8000-000000000905';
const scoringEventId = '01941f29-7c00-7000-8000-000000000903';
const joinedAt = new Date('2026-09-04T14:00:00.000Z');
const leftAt = new Date('2026-09-04T14:15:00.000Z');
const context = fakeAuthorizationContext({ houseId, viewerId });

interface AttendanceRow {
  readonly id: string;
  readonly house_id: string;
  readonly night_id: string;
  readonly season_id: string;
  readonly membership_id: string;
  readonly first_joined_at: Date;
  readonly current_joined_at: Date | null;
  readonly last_left_at: Date | null;
  readonly accumulated_seconds: number;
  readonly qualified_at: Date | null;
  readonly qualification_reason: string | null;
  readonly interval_started?: boolean;
}

function attendanceRow(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: attendanceId,
    house_id: houseId,
    night_id: nightId,
    season_id: seasonId,
    membership_id: membershipId,
    first_joined_at: joinedAt,
    current_joined_at: joinedAt,
    last_left_at: null,
    accumulated_seconds: 0,
    qualified_at: null,
    qualification_reason: null,
    ...overrides,
  };
}

interface AttendanceDatabaseOptions {
  readonly joinRow?: AttendanceRow;
  readonly lockedRow?: AttendanceRow | null;
  readonly leaveRow?: AttendanceRow;
}

function database(options: AttendanceDatabaseOptions = {}) {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('from house_nights n') && sql.includes("n.state = 'live'")) {
      return { rows: [{ season_id: seasonId, membership_id: membershipId }], rowCount: 1 };
    }
    if (sql.includes('insert into night_attendance') && sql.includes('on conflict')) {
      const joinRow = options.joinRow;
      if (joinRow !== undefined && joinRow.interval_started === false) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [joinRow ?? attendanceRow({ interval_started: true })], rowCount: 1 };
    }
    if (sql.includes('false as interval_started')) {
      return {
        rows: [options.joinRow ?? attendanceRow({ interval_started: false })],
        rowCount: 1,
      };
    }
    if (sql.includes('insert into night_attendance_events')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('for update of a') && sql.includes('from night_attendance a')) {
      const locked = options.lockedRow === undefined ? attendanceRow() : options.lockedRow;
      return { rows: locked === null ? [] : [locked], rowCount: locked === null ? 0 : 1 };
    }
    if (sql.includes('update night_attendance a') && sql.includes('last_left_at')) {
      return {
        rows: [
          options.leaveRow ??
            attendanceRow({
              current_joined_at: null,
              last_left_at: leftAt,
              accumulated_seconds: 900,
              qualified_at: leftAt,
              qualification_reason: 'duration',
            }),
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('insert into outbox_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled attendance query: ${sql}`);
  });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  return { pool, clientQuery, connect, release };
}

describe('BM-036 PostgreSQL Night attendance join/leave events', () => {
  it('records a join event when a new interval starts', async () => {
    const databaseState = database();

    await expect(
      new PgNightAttendanceRepository(databaseState.pool).join(context, {
        attendanceId,
        eventId: joinEventId,
        nightId,
        joinedAt,
      }),
    ).resolves.toMatchObject({ attendanceId, joinedNow: true, currentJoinedAt: joinedAt });
    expect(databaseState.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into night_attendance_events'),
      [joinEventId, houseId, attendanceId, nightId, membershipId, 'join', joinedAt],
    );
    expect(databaseState.release).toHaveBeenCalledOnce();
  });

  it('does not record a join event for an already-open interval', async () => {
    const databaseState = database({
      joinRow: attendanceRow({ interval_started: false }),
    });

    await expect(
      new PgNightAttendanceRepository(databaseState.pool).join(context, {
        attendanceId,
        eventId: joinEventId,
        nightId,
        joinedAt,
      }),
    ).resolves.toMatchObject({ joinedNow: false });
    expect(
      databaseState.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes('insert into night_attendance_events'),
      ),
    ).toBe(false);
  });

  it('accrues duration, records leave, and emits the scoring event once', async () => {
    const databaseState = database({
      lockedRow: attendanceRow({ current_joined_at: joinedAt, accumulated_seconds: 0 }),
    });

    await expect(
      new PgNightAttendanceRepository(databaseState.pool).leave(context, {
        nightId,
        eventId: leaveEventId,
        scoringEventId,
        leftAt,
      }),
    ).resolves.toMatchObject({
      leftNow: true,
      accumulatedSeconds: 900,
      scoringEventEmitted: true,
    });
    expect(databaseState.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into night_attendance_events'),
      [leaveEventId, houseId, attendanceId, nightId, membershipId, 'leave', leftAt],
    );
    expect(databaseState.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into outbox_events'),
      expect.any(Array),
    );
  });

  it('treats a repeated leave as an idempotent no-op', async () => {
    const databaseState = database({
      lockedRow: attendanceRow({ current_joined_at: null, last_left_at: leftAt }),
    });

    await expect(
      new PgNightAttendanceRepository(databaseState.pool).leave(context, {
        nightId,
        eventId: leaveEventId,
        scoringEventId,
        leftAt,
      }),
    ).resolves.toMatchObject({ leftNow: false, scoringEventEmitted: false });
    expect(
      databaseState.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes('insert into night_attendance_events'),
      ),
    ).toBe(false);
  });
});
