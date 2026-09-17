import {
  DomainError,
  NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
  NIGHT_ATTENDANCE_THRESHOLD_SECONDS,
  nightAttendanceSourceKey,
  type AuthorizationContext,
  type JoinNightAttendanceInput,
  type LeaveNightAttendanceInput,
  type NightAttendance,
  type NightAttendanceLeaveResult,
  type NightAttendanceQualificationReason,
  type NightAttendanceRepository,
  type QualifyNightAttendanceInput,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

interface AuthorizedNightRow extends QueryResultRow {
  readonly season_id: unknown;
  readonly membership_id: unknown;
}

interface AttendanceRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly night_id: unknown;
  readonly season_id: unknown;
  readonly membership_id: unknown;
  readonly first_joined_at: unknown;
  readonly current_joined_at: unknown;
  readonly last_left_at: unknown;
  readonly accumulated_seconds: unknown;
  readonly qualified_at: unknown;
  readonly qualification_reason: unknown;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid attendance ${field}`);
  return value;
}

function dateValue(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid attendance ${field}`);
  }
  return value;
}

function nullableDate(value: unknown, field: string): Date | null {
  return value === null ? null : dateValue(value, field);
}

function qualificationReason(value: unknown): NightAttendanceQualificationReason | null {
  if (value === null || value === 'duration' || value === 'completed_live_game') return value;
  throw new Error('Invalid attendance qualification reason');
}

function parseAttendance(row: AttendanceRow): NightAttendance {
  if (!Number.isInteger(row.accumulated_seconds) || Number(row.accumulated_seconds) < 0) {
    throw new Error('Invalid attendance accumulated seconds');
  }
  return {
    attendanceId: stringValue(row.id, 'id'),
    houseId: stringValue(row.house_id, 'House id'),
    nightId: stringValue(row.night_id, 'Night id'),
    seasonId: stringValue(row.season_id, 'Season id'),
    membershipId: stringValue(row.membership_id, 'membership id'),
    firstJoinedAt: dateValue(row.first_joined_at, 'first join'),
    currentJoinedAt: nullableDate(row.current_joined_at, 'current join'),
    lastLeftAt: nullableDate(row.last_left_at, 'last leave'),
    accumulatedSeconds: Number(row.accumulated_seconds),
    qualifiedAt: nullableDate(row.qualified_at, 'qualification'),
    qualificationReason: qualificationReason(row.qualification_reason),
  };
}

async function transaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const attendanceColumns = `a.id::text, a.house_id::text, a.night_id::text,
  n.season_id::text as season_id, a.membership_id::text,
  a.first_joined_at, a.current_joined_at, a.last_left_at, a.accumulated_seconds,
  a.qualified_at, a.qualification_reason`;

async function authorizedLiveNight(
  client: PoolClient,
  context: AuthorizationContext,
  nightId: string,
): Promise<AuthorizedNightRow> {
  const result = await client.query<AuthorizedNightRow>(
    `select n.season_id::text as season_id, m.id::text as membership_id
       from house_nights n
       join seasons s
         on s.id = n.season_id and s.house_id = n.house_id and s.state = 'active'
       join houses h on h.id = n.house_id and h.status = 'active'
       join memberships m
         on m.house_id = n.house_id and m.user_id = $3 and m.status = 'active'
      where n.id = $1 and n.house_id = $2 and n.state = 'live'
      for share of n, s, m`,
    [nightId, context.houseId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Live Night is unavailable');
  return row;
}

function assertValidInstant(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new DomainError('validation_failed', 'Attendance timestamp is invalid');
  }
}

function effectiveAccumulatedSeconds(attendance: NightAttendance, at: Date): number {
  if (attendance.currentJoinedAt === null) return attendance.accumulatedSeconds;
  const elapsedMilliseconds = at.getTime() - attendance.currentJoinedAt.getTime();
  if (elapsedMilliseconds < 0) {
    throw new DomainError('conflict', 'Attendance time precedes its current join');
  }
  return attendance.accumulatedSeconds + Math.floor(elapsedMilliseconds / 1_000);
}

async function enqueueQualificationEvent(
  attendance: NightAttendance,
  input: {
    readonly scoringEventId: string;
    readonly qualifiedAt: Date;
    readonly reason: NightAttendanceQualificationReason;
  },
  client: PoolClient,
): Promise<string> {
  const sourceKey = nightAttendanceSourceKey(attendance.nightId);
  await enqueueOutboxEvent(
    {
      id: input.scoringEventId,
      topic: NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
      aggregateId: attendance.attendanceId,
      sequence: 1n,
      houseId: attendance.houseId,
      payload: {
        membershipId: attendance.membershipId,
        nightId: attendance.nightId,
        points: 1,
        qualificationReason: input.reason,
        seasonId: attendance.seasonId,
        sourceKey,
        sourceKind: 'night_attendance',
      },
      availableAt: input.qualifiedAt,
      occurredAt: input.qualifiedAt,
    },
    client,
  );
  return sourceKey;
}

/** [BM-033] [DR-NIGHT-02/05] PostgreSQL attendance intervals and atomic scoring source. */
export class PgNightAttendanceRepository implements NightAttendanceRepository {
  constructor(private readonly database: Pool) {}

  async join(
    context: AuthorizationContext,
    input: JoinNightAttendanceInput,
  ): Promise<NightAttendance> {
    assertValidInstant(input.joinedAt);
    return transaction(this.database, async (client) => {
      const authorized = await authorizedLiveNight(client, context, input.nightId);
      const membershipId = stringValue(authorized.membership_id, 'membership id');
      const result = await client.query<AttendanceRow>(
        `insert into night_attendance
          (id, house_id, night_id, membership_id, first_joined_at,
           current_joined_at, accumulated_seconds, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $5, 0, $5, $5)
         on conflict (night_id, membership_id) do update
           set current_joined_at = case
                 when night_attendance.current_joined_at is null then excluded.current_joined_at
                 else night_attendance.current_joined_at
               end,
               updated_at = case
                 when night_attendance.current_joined_at is null then excluded.updated_at
                 else night_attendance.updated_at
               end
         returning id::text, house_id::text, night_id::text, $6::text as season_id,
                   membership_id::text, first_joined_at, current_joined_at,
                   last_left_at, accumulated_seconds, qualified_at,
                   qualification_reason`,
        [
          input.attendanceId,
          context.houseId,
          input.nightId,
          membershipId,
          input.joinedAt,
          stringValue(authorized.season_id, 'Season id'),
        ],
      );
      return parseAttendance(result.rows[0] as AttendanceRow);
    });
  }

  async leave(
    context: AuthorizationContext,
    input: LeaveNightAttendanceInput,
  ): Promise<NightAttendanceLeaveResult | null> {
    assertValidInstant(input.leftAt);
    return transaction(this.database, async (client) => {
      const locked = await client.query<AttendanceRow>(
        `select ${attendanceColumns}
           from night_attendance a
           join house_nights n on n.id = a.night_id and n.house_id = a.house_id
           join memberships m
             on m.id = a.membership_id
            and m.house_id = a.house_id
            and m.user_id = $3
            and m.status = 'active'
          where a.night_id = $1 and a.house_id = $2
          for update of a`,
        [input.nightId, context.houseId, context.viewerId],
      );
      const row = locked.rows[0];
      if (row === undefined) return null;
      const attendance = parseAttendance(row);
      if (attendance.currentJoinedAt === null) {
        return { ...attendance, scoringEventEmitted: false, sourceKey: null };
      }
      const accumulatedSeconds = effectiveAccumulatedSeconds(attendance, input.leftAt);
      const qualifiedNow =
        attendance.qualifiedAt === null &&
        attendance.accumulatedSeconds < NIGHT_ATTENDANCE_THRESHOLD_SECONDS &&
        accumulatedSeconds >= NIGHT_ATTENDANCE_THRESHOLD_SECONDS;
      const updated = await client.query<AttendanceRow>(
        `update night_attendance a
            set current_joined_at = null,
                last_left_at = $3,
                accumulated_seconds = $4,
                qualified_at = case when $5 then $3 else qualified_at end,
                qualification_reason = case when $5 then 'duration' else qualification_reason end,
                updated_at = $3
          where a.id = $1 and a.house_id = $2
        returning a.id::text, a.house_id::text, a.night_id::text,
                  $6::text as season_id, a.membership_id::text,
                  a.first_joined_at, a.current_joined_at, a.last_left_at,
                  a.accumulated_seconds, a.qualified_at, a.qualification_reason`,
        [
          attendance.attendanceId,
          context.houseId,
          input.leftAt,
          accumulatedSeconds,
          qualifiedNow,
          attendance.seasonId,
        ],
      );
      const result = parseAttendance(updated.rows[0] as AttendanceRow);
      if (!qualifiedNow) {
        return { ...result, scoringEventEmitted: false, sourceKey: null };
      }

      const sourceKey = await enqueueQualificationEvent(
        result,
        { scoringEventId: input.scoringEventId, qualifiedAt: input.leftAt, reason: 'duration' },
        client,
      );
      return { ...result, scoringEventEmitted: true, sourceKey };
    });
  }

  async qualify(input: QualifyNightAttendanceInput): Promise<NightAttendanceLeaveResult | null> {
    assertValidInstant(input.qualifiedAt);
    return transaction(this.database, async (client) => {
      const locked = await client.query<AttendanceRow>(
        `select ${attendanceColumns}
           from night_attendance a
           join house_nights n on n.id = a.night_id and n.house_id = a.house_id
           join seasons s
             on s.id = n.season_id and s.house_id = n.house_id and s.state = 'active'
           join memberships m
             on m.id = a.membership_id and m.house_id = a.house_id and m.status = 'active'
          where a.night_id = $1 and a.house_id = $2 and a.membership_id = $3
            and n.state in ('live', 'ended')
          for update of a`,
        [input.nightId, input.houseId, input.membershipId],
      );
      const row = locked.rows[0];
      if (row === undefined) return null;
      const attendance = parseAttendance(row);
      if (attendance.qualifiedAt !== null) {
        return { ...attendance, scoringEventEmitted: false, sourceKey: null };
      }
      const effectiveSeconds = effectiveAccumulatedSeconds(attendance, input.qualifiedAt);
      if (input.reason === 'duration' && effectiveSeconds < NIGHT_ATTENDANCE_THRESHOLD_SECONDS) {
        return { ...attendance, scoringEventEmitted: false, sourceKey: null };
      }

      const updated = await client.query<AttendanceRow>(
        `update night_attendance a
            set qualified_at = $3,
                qualification_reason = $4,
                accumulated_seconds = case when $4 = 'duration' then $6
                                           else accumulated_seconds end,
                current_joined_at = case when $4 = 'duration' and current_joined_at is not null
                                         then $3 else current_joined_at end,
                updated_at = $3
          where a.id = $1 and a.house_id = $2
        returning a.id::text, a.house_id::text, a.night_id::text,
                  $5::text as season_id, a.membership_id::text,
                  a.first_joined_at, a.current_joined_at, a.last_left_at,
                  a.accumulated_seconds, a.qualified_at, a.qualification_reason`,
        [
          attendance.attendanceId,
          attendance.houseId,
          input.qualifiedAt,
          input.reason,
          attendance.seasonId,
          effectiveSeconds,
        ],
      );
      const result = parseAttendance(updated.rows[0] as AttendanceRow);
      const sourceKey = await enqueueQualificationEvent(result, input, client);
      return { ...result, scoringEventEmitted: true, sourceKey };
    });
  }
}
