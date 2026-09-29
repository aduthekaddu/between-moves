import {
  accumulatedAttendanceSeconds,
  crossedAttendanceDurationThreshold,
  DomainError,
  NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
  nightAttendanceSourceKey,
  type AuthorizationContext,
  type CompletedLiveGameReader,
  type CompletedLiveNightGame,
  type JoinNightAttendanceInput,
  type LeaveNightAttendanceInput,
  type NightAttendance,
  type NightAttendanceJoinResult,
  type NightAttendanceLeaveResult,
  type NightAttendanceQualificationReason,
  type NightAttendanceReadRepository,
  type NightAttendanceRepository,
  type NightAttendanceSettlementInput,
  type NightAttendanceSettlementResult,
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
  readonly interval_started?: unknown;
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

function attendanceRow(rows: readonly AttendanceRow[], field: string): AttendanceRow {
  const row = rows[0];
  if (row === undefined) throw new Error(`Invalid attendance ${field}`);
  return row;
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

async function insertAttendanceEvent(
  client: PoolClient,
  input: {
    readonly eventId: string;
    readonly houseId: string;
    readonly attendanceId: string;
    readonly nightId: string;
    readonly membershipId: string;
    readonly kind: 'join' | 'leave';
    readonly occurredAt: Date;
  },
): Promise<void> {
  await client.query(
    `insert into night_attendance_events
      (id, house_id, attendance_id, night_id, membership_id, kind, occurred_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [
      input.eventId,
      input.houseId,
      input.attendanceId,
      input.nightId,
      input.membershipId,
      input.kind,
      input.occurredAt,
    ],
  );
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

interface SettlementRow extends AttendanceRow {
  readonly membership_active: unknown;
}

interface CompletedLiveGameRow extends QueryResultRow {
  readonly game_id: unknown;
  readonly house_id: unknown;
  readonly night_id: unknown;
  readonly white_membership_id: unknown;
  readonly black_membership_id: unknown;
  readonly completed_at: unknown;
}

/**
 * [BM-036] [DR-NIGHT-02/05] Close every interval still open when a Night ends, on the ending
 * transaction's client. Each close is a server-timed leave, so crossing 15 minutes this way
 * qualifies an active Member exactly as stepping away would.
 */
export async function settleNightAttendance(
  client: PoolClient,
  input: NightAttendanceSettlementInput,
): Promise<NightAttendanceSettlementResult> {
  assertValidInstant(input.endedAt);
  const open = await client.query<SettlementRow>(
    `select ${attendanceColumns}, (m.status = 'active') as membership_active
       from night_attendance a
       join house_nights n on n.id = a.night_id and n.house_id = a.house_id
       join memberships m on m.id = a.membership_id and m.house_id = a.house_id
      where a.night_id = $1 and a.house_id = $2 and a.current_joined_at is not null
      order by a.id
      for update of a`,
    [input.nightId, input.houseId],
  );
  let qualified = 0;
  for (const row of open.rows) {
    const attendance = parseAttendance(row);
    const currentJoinedAt = attendance.currentJoinedAt;
    if (currentJoinedAt === null) continue;
    // server clocks can disagree by a moment; an interval never closes before it opened
    const leftAt = input.endedAt < currentJoinedAt ? currentJoinedAt : input.endedAt;
    const accumulatedSeconds = accumulatedAttendanceSeconds({
      accumulatedSeconds: attendance.accumulatedSeconds,
      currentJoinedAt,
      at: leftAt,
    });
    const qualifiedNow =
      row.membership_active === true &&
      crossedAttendanceDurationThreshold({
        alreadyQualified: attendance.qualifiedAt !== null,
        previousSeconds: attendance.accumulatedSeconds,
        accumulatedSeconds,
      });
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
        input.houseId,
        leftAt,
        accumulatedSeconds,
        qualifiedNow,
        attendance.seasonId,
      ],
    );
    const result = parseAttendance(attendanceRow(updated.rows, 'settlement'));
    await insertAttendanceEvent(client, {
      eventId: input.ids.generate(),
      houseId: result.houseId,
      attendanceId: result.attendanceId,
      nightId: result.nightId,
      membershipId: result.membershipId,
      kind: 'leave',
      occurredAt: leftAt,
    });
    if (qualifiedNow) {
      await enqueueQualificationEvent(
        result,
        { scoringEventId: input.ids.generate(), qualifiedAt: leftAt, reason: 'duration' },
        client,
      );
      qualified += 1;
    }
  }
  return { closedIntervals: open.rows.length, qualified };
}

/** [BM-033] [BM-036] [DR-NIGHT-02/05] Unique (night, member) join/leave events, duration accrual, and scoring source. */
export class PgNightAttendanceRepository
  implements NightAttendanceRepository, NightAttendanceReadRepository, CompletedLiveGameReader
{
  constructor(private readonly database: Pool) {}

  /** [BM-033] [DR-NIGHT-05] Derive a completed live Game's Night and players from durable state. */
  async readCompletedLiveGame(input: {
    readonly houseId: string;
    readonly gameId: string;
  }): Promise<CompletedLiveNightGame | null> {
    const result = await this.database.query<CompletedLiveGameRow>(
      `select g.id::text as game_id, g.house_id::text as house_id, g.night_id::text as night_id,
              g.white_membership_id::text as white_membership_id,
              g.black_membership_id::text as black_membership_id,
              g.completed_at
         from games g
         join houses h on h.id = g.house_id and h.status = 'active'
        where g.id = $1 and g.house_id = $2
          and g.mode = 'live' and g.state = 'completed' and g.night_id is not null`,
      [input.gameId, input.houseId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      houseId: stringValue(row.house_id, 'House id'),
      gameId: stringValue(row.game_id, 'Game id'),
      nightId: stringValue(row.night_id, 'Night id'),
      completedAt: dateValue(row.completed_at, 'Game completion'),
      membershipIds: [
        stringValue(row.white_membership_id, 'white membership id'),
        stringValue(row.black_membership_id, 'black membership id'),
      ],
    };
  }

  /** [BM-036] The viewer's own row for one Night, read through active House membership. */
  async readViewerAttendance(
    context: AuthorizationContext,
    nightId: string,
  ): Promise<NightAttendance | null> {
    const result = await this.database.query<AttendanceRow>(
      `select ${attendanceColumns}
         from night_attendance a
         join house_nights n on n.id = a.night_id and n.house_id = a.house_id
         join houses h on h.id = a.house_id and h.status = 'active'
         join memberships m
           on m.id = a.membership_id
          and m.house_id = a.house_id
          and m.user_id = $3
          and m.status = 'active'
        where a.night_id = $1 and a.house_id = $2`,
      [nightId, context.houseId, context.viewerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseAttendance(row);
  }

  async join(
    context: AuthorizationContext,
    input: JoinNightAttendanceInput,
  ): Promise<NightAttendanceJoinResult> {
    assertValidInstant(input.joinedAt);
    return transaction(this.database, async (client) => {
      const authorized = await authorizedLiveNight(client, context, input.nightId);
      const membershipId = stringValue(authorized.membership_id, 'membership id');
      const seasonId = stringValue(authorized.season_id, 'Season id');
      const upserted = await client.query<AttendanceRow>(
        `insert into night_attendance
           (id, house_id, night_id, membership_id, first_joined_at,
            current_joined_at, accumulated_seconds, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $5, 0, $5, $5)
         on conflict (night_id, membership_id) do update
           set current_joined_at = excluded.current_joined_at,
               updated_at = excluded.updated_at
         where night_attendance.current_joined_at is null
         returning id::text, house_id::text, night_id::text, $6::text as season_id,
                   membership_id::text, first_joined_at, current_joined_at,
                   last_left_at, accumulated_seconds, qualified_at,
                   qualification_reason, true as interval_started`,
        [
          input.attendanceId,
          context.houseId,
          input.nightId,
          membershipId,
          input.joinedAt,
          seasonId,
        ],
      );
      const existing =
        upserted.rows[0] === undefined
          ? await client.query<AttendanceRow>(
              `select ${attendanceColumns}, false as interval_started
                 from night_attendance a
                 join house_nights n on n.id = a.night_id and n.house_id = a.house_id
                where a.night_id = $1 and a.house_id = $2 and a.membership_id = $3`,
              [input.nightId, context.houseId, membershipId],
            )
          : upserted;
      const row = attendanceRow(existing.rows, 'join');
      const attendance = parseAttendance(row);
      const joinedNow = row.interval_started === true;
      if (joinedNow) {
        await insertAttendanceEvent(client, {
          eventId: input.eventId,
          houseId: attendance.houseId,
          attendanceId: attendance.attendanceId,
          nightId: attendance.nightId,
          membershipId: attendance.membershipId,
          kind: 'join',
          occurredAt: input.joinedAt,
        });
      }
      return { ...attendance, joinedNow };
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
        return { ...attendance, leftNow: false, scoringEventEmitted: false, sourceKey: null };
      }
      const accumulatedSeconds = accumulatedAttendanceSeconds({
        accumulatedSeconds: attendance.accumulatedSeconds,
        currentJoinedAt: attendance.currentJoinedAt,
        at: input.leftAt,
      });
      const qualifiedNow = crossedAttendanceDurationThreshold({
        alreadyQualified: attendance.qualifiedAt !== null,
        previousSeconds: attendance.accumulatedSeconds,
        accumulatedSeconds,
      });
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
      const result = parseAttendance(attendanceRow(updated.rows, 'leave'));
      await insertAttendanceEvent(client, {
        eventId: input.eventId,
        houseId: result.houseId,
        attendanceId: result.attendanceId,
        nightId: result.nightId,
        membershipId: result.membershipId,
        kind: 'leave',
        occurredAt: input.leftAt,
      });
      if (!qualifiedNow) {
        return { ...result, leftNow: true, scoringEventEmitted: false, sourceKey: null };
      }

      const sourceKey = await enqueueQualificationEvent(
        result,
        { scoringEventId: input.scoringEventId, qualifiedAt: input.leftAt, reason: 'duration' },
        client,
      );
      return { ...result, leftNow: true, scoringEventEmitted: true, sourceKey };
    });
  }

  async qualify(input: QualifyNightAttendanceInput): Promise<NightAttendanceLeaveResult | null> {
    assertValidInstant(input.qualifiedAt);
    return transaction(this.database, async (client) => {
      const lockEligible = () =>
        client.query<AttendanceRow>(
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
      let locked = await lockEligible();
      if (
        locked.rows[0] === undefined &&
        input.reason === 'completed_live_game' &&
        input.attendanceId !== undefined
      ) {
        // [DR-NIGHT-05] a finished live Game is attendance even without a chair on the rail
        await client.query(
          `insert into night_attendance
             (id, house_id, night_id, membership_id, first_joined_at, current_joined_at,
              accumulated_seconds, created_at, updated_at)
           select $1, n.house_id, n.id, m.id, $5, null, 0, $5, $5
             from house_nights n
             join houses h on h.id = n.house_id and h.status = 'active'
             join seasons s
               on s.id = n.season_id and s.house_id = n.house_id and s.state = 'active'
             join memberships m
               on m.id = $4 and m.house_id = n.house_id and m.status = 'active'
            where n.id = $2 and n.house_id = $3 and n.state in ('live', 'ended')
           on conflict (night_id, membership_id) do nothing`,
          [input.attendanceId, input.nightId, input.houseId, input.membershipId, input.qualifiedAt],
        );
        locked = await lockEligible();
      }
      const row = locked.rows[0];
      if (row === undefined) return null;
      const attendance = parseAttendance(row);
      if (attendance.qualifiedAt !== null) {
        return { ...attendance, leftNow: false, scoringEventEmitted: false, sourceKey: null };
      }
      if (input.reason === 'completed_live_game') {
        // a Game can finish (a flag, say) just before its player first pulls up a chair
        const qualifiedAt =
          input.qualifiedAt < attendance.firstJoinedAt
            ? attendance.firstJoinedAt
            : input.qualifiedAt;
        const updated = await client.query<AttendanceRow>(
          `update night_attendance a
              set qualified_at = $3, qualification_reason = 'completed_live_game', updated_at = $3
            where a.id = $1 and a.house_id = $2
          returning a.id::text, a.house_id::text, a.night_id::text,
                    $4::text as season_id, a.membership_id::text,
                    a.first_joined_at, a.current_joined_at, a.last_left_at,
                    a.accumulated_seconds, a.qualified_at, a.qualification_reason`,
          [attendance.attendanceId, attendance.houseId, qualifiedAt, attendance.seasonId],
        );
        const result = parseAttendance(attendanceRow(updated.rows, 'qualify'));
        const sourceKey = await enqueueQualificationEvent(
          result,
          { scoringEventId: input.scoringEventId, qualifiedAt, reason: input.reason },
          client,
        );
        return { ...result, leftNow: false, scoringEventEmitted: true, sourceKey };
      }
      const effectiveSeconds = accumulatedAttendanceSeconds({
        accumulatedSeconds: attendance.accumulatedSeconds,
        currentJoinedAt: attendance.currentJoinedAt,
        at: input.qualifiedAt,
      });
      if (
        input.reason === 'duration' &&
        !crossedAttendanceDurationThreshold({
          alreadyQualified: false,
          previousSeconds: 0,
          accumulatedSeconds: effectiveSeconds,
        })
      ) {
        return { ...attendance, leftNow: false, scoringEventEmitted: false, sourceKey: null };
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
      const result = parseAttendance(attendanceRow(updated.rows, 'qualify'));
      const sourceKey = await enqueueQualificationEvent(result, input, client);
      return { ...result, leftNow: false, scoringEventEmitted: true, sourceKey };
    });
  }
}
