import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNightAttendanceRepository } from './pg-night-attendance-repository';
import { PgNightLifecycleRepository } from './pg-night-lifecycle-repository';
import { PgNightRsvpRepository } from './pg-night-rsvp-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000801';
const charterId = '01941f29-7c00-7000-8000-000000000811';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000901',
  '01941f29-7c00-7000-8000-000000000902',
  '01941f29-7c00-7000-8000-000000000903',
  '01941f29-7c00-7000-8000-000000000904',
] as const;
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startedAt = new Date('2026-09-04T14:00:00.000Z');
const endedAt = new Date('2026-09-04T16:00:00.000Z');
/** No attendance is open in the plain lifecycle cases, so settlement asks for no IDs. */
const unusedIds = {
  generate: (): string => {
    throw new Error('Settlement needed an ID with no open attendance');
  },
};

describe('PostgreSQL Between Moves Night lifecycle', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const seasons = new PgSeasonRepository(database);
  const lifecycle = new PgNightLifecycleRepository(database);
  const rsvps = new PgNightRsvpRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    await seasons.draft(owner, {
      seasonId,
      title: 'Autumn tables',
      idempotencyKey: null,
      createdAt,
    });
    await seasons.draftCharter(owner, {
      charterId,
      seasonId,
      correspondencePaceHours: 24,
      nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      pointsRecipe: {
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 4, puzzles: 2 },
      },
      createdAt,
    });
    await seasons.publish(owner, {
      seasonId,
      title: 'Autumn tables',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      publishedAt: createdAt,
      nightIds,
    });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-035] [DR-NIGHT-03] starts and ends with host scope and server timestamps', async () => {
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    const host = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    const member = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    const extraUserId = '01941f29-7c00-7000-8000-000000000650';
    const extraMembershipId = '01941f29-7c00-7000-8000-000000000651';
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Cora', 'cora-lifecycle@example.test', true)`,
      [extraUserId],
    );
    await database.query(
      `insert into memberships
        (id, house_id, user_id, role, status, joined_at, created_at, updated_at)
       values ($1, $2, $3, 'member', 'active', $4, $4, $4)`,
      [extraMembershipId, world.first.houseId, extraUserId, createdAt],
    );
    const extraMember = fakeAuthorizationContext({
      viewerId: extraUserId,
      houseId: world.first.houseId,
    });

    await expect(
      lifecycle.start(member, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000921',
        at: startedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    await expect(
      lifecycle.assignHost(owner, {
        nightId: nightIds[0],
        hostMembershipId: world.first.nonOwner.membershipId,
        assignedAt: createdAt,
      }),
    ).resolves.toMatchObject({
      night: { hostMembershipId: world.first.nonOwner.membershipId },
      changedNow: true,
    });
    const role = await database.query('select role from memberships where id = $1', [
      world.first.nonOwner.membershipId,
    ]);
    expect(role.rows).toEqual([{ role: 'member' }]);
    await expect(
      lifecycle.start(extraMember, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000929',
        at: startedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      lifecycle.start(host, {
        nightId: nightIds[1],
        eventId: '01941f29-7c00-7000-8000-000000000930',
        at: startedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    await expect(
      lifecycle.start(owner, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000922',
        at: startedAt,
      }),
    ).resolves.toMatchObject({
      night: { state: 'live', startedAt },
      changedNow: true,
    });
    await expect(
      lifecycle.start(owner, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000923',
        at: new Date('2026-09-04T14:05:00.000Z'),
      }),
    ).resolves.toMatchObject({
      night: { startedAt },
      changedNow: false,
    });

    await expect(
      lifecycle.end(host, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000924',
        at: endedAt,
        settlementIds: unusedIds,
      }),
    ).resolves.toMatchObject({
      night: { state: 'ended', startedAt, endedAt },
      changedNow: true,
    });

    const events = await database.query(
      `select topic, sequence::text, payload
         from outbox_events
        where aggregate_id = $1
        order by sequence`,
      [nightIds[0]],
    );
    expect(events.rows).toEqual([
      {
        topic: 'night.started',
        sequence: '1',
        payload: { nightId: nightIds[0], at: startedAt.toISOString() },
      },
      {
        topic: 'night.ended',
        sequence: '2',
        payload: { nightId: nightIds[0], at: endedAt.toISOString() },
      },
    ]);
    await expect(
      lifecycle.isAssignedNightHost({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        operation: 'start',
      }),
    ).resolves.toBe(false);
    await expect(
      lifecycle.isAssignedNightHost({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        operation: 'end',
      }),
    ).resolves.toBe(true);
  });

  it('[BM-035] [DR-SEC-01] denies cross-House start, host assignment, and RSVP', async () => {
    const otherOwner = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    const otherMember = fakeAuthorizationContext({
      viewerId: world.second.nonOwner.userId,
      houseId: world.second.houseId,
    });

    await expect(
      lifecycle.start(otherOwner, {
        nightId: nightIds[0],
        eventId: '01941f29-7c00-7000-8000-000000000925',
        at: startedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      lifecycle.assignHost(otherOwner, {
        nightId: nightIds[0],
        hostMembershipId: world.second.member.membershipId,
        assignedAt: createdAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      rsvps.rsvp(otherMember, {
        rsvpId: '01941f29-7c00-7000-8000-000000000926',
        nightId: nightIds[0],
        status: 'going',
        respondedAt: createdAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const candidates = await lifecycle.listHostCandidates(otherOwner);
    expect(candidates.map((candidate) => candidate.membershipId)).not.toContain(
      world.first.member.membershipId,
    );
    const row = await database.query(
      'select state, host_membership_id from house_nights where id = $1',
      [nightIds[0]],
    );
    expect(row.rows).toEqual([{ state: 'scheduled', host_membership_id: null }]);
  });

  it('[BM-036] [DR-NIGHT-02/05] closes open attendance when the Night ends and scores 15 minutes', async () => {
    const attendance = new PgNightAttendanceRepository(database);
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    const bea = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    const mira = fakeAuthorizationContext({
      viewerId: world.switchingMember.userId,
      houseId: world.first.houseId,
    });
    let next = 0;
    const ids = {
      generate: () => `01941f29-7c00-7000-8000-${(1_000 + next++).toString().padStart(12, '0')}`,
    };
    const minutes = (count: number) => new Date(startedAt.getTime() + count * 60_000);
    await lifecycle.start(owner, { nightId: nightIds[0], eventId: ids.generate(), at: startedAt });
    const join = (context: typeof owner, at: Date) =>
      attendance.join(context, {
        attendanceId: ids.generate(),
        eventId: ids.generate(),
        nightId: nightIds[0],
        joinedAt: at,
      });
    // Bea stays all Night, Mira arrives five minutes before the end, Ada leaves after ten
    await join(bea, startedAt);
    await join(mira, minutes(115));
    await join(owner, startedAt);
    await attendance.leave(owner, {
      nightId: nightIds[0],
      eventId: ids.generate(),
      scoringEventId: ids.generate(),
      leftAt: minutes(10),
    });

    await expect(
      lifecycle.end(owner, {
        nightId: nightIds[0],
        eventId: ids.generate(),
        at: endedAt,
        settlementIds: ids,
      }),
    ).resolves.toMatchObject({ changedNow: true, night: { state: 'ended' } });

    const rows = await database.query(
      `select membership_id::text, current_joined_at, last_left_at, accumulated_seconds,
              qualified_at, qualification_reason
         from night_attendance where night_id = $1 order by accumulated_seconds desc`,
      [nightIds[0]],
    );
    expect(rows.rows).toEqual([
      {
        membership_id: world.first.nonOwner.membershipId,
        current_joined_at: null,
        last_left_at: endedAt,
        accumulated_seconds: 7_200,
        qualified_at: endedAt,
        qualification_reason: 'duration',
      },
      {
        membership_id: world.first.member.membershipId,
        current_joined_at: null,
        last_left_at: minutes(10),
        accumulated_seconds: 600,
        qualified_at: null,
        qualification_reason: null,
      },
      {
        membership_id: world.switchingMember.firstMembershipId,
        current_joined_at: null,
        last_left_at: endedAt,
        accumulated_seconds: 300,
        qualified_at: null,
        qualification_reason: null,
      },
    ]);
    const leaves = await database.query(
      `select membership_id::text, occurred_at from night_attendance_events
        where night_id = $1 and kind = 'leave' order by occurred_at, membership_id`,
      [nightIds[0]],
    );
    expect(leaves.rows).toHaveLength(3);
    expect(
      leaves.rows.filter((row) => row.occurred_at.getTime() === endedAt.getTime()),
    ).toHaveLength(2);
    const scoring = await database.query(
      `select payload->>'membershipId' as membership_id, payload->>'qualificationReason' as reason
         from outbox_events where topic = 'night.attendance-qualified'`,
    );
    expect(scoring.rows).toEqual([
      { membership_id: world.first.nonOwner.membershipId, reason: 'duration' },
    ]);

    // after the end nobody accrues more time, and repeating the end settles nothing again
    await expect(
      attendance.leave(bea, {
        nightId: nightIds[0],
        eventId: ids.generate(),
        scoringEventId: ids.generate(),
        leftAt: new Date(endedAt.getTime() + 3_600_000),
      }),
    ).resolves.toMatchObject({ leftNow: false, accumulatedSeconds: 7_200 });
    await expect(
      lifecycle.end(owner, {
        nightId: nightIds[0],
        eventId: ids.generate(),
        at: new Date(endedAt.getTime() + 60_000),
        settlementIds: unusedIds,
      }),
    ).resolves.toMatchObject({ changedNow: false });
  });

  it('[BM-035] upserts a Member RSVP with server time', async () => {
    const member = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    await expect(
      rsvps.rsvp(member, {
        rsvpId: '01941f29-7c00-7000-8000-000000000927',
        nightId: nightIds[0],
        status: 'going',
        respondedAt: createdAt,
      }),
    ).resolves.toMatchObject({ status: 'going', respondedAt: createdAt });
    await expect(
      rsvps.rsvp(member, {
        rsvpId: '01941f29-7c00-7000-8000-000000000928',
        nightId: nightIds[0],
        status: 'not_going',
        respondedAt: startedAt,
      }),
    ).resolves.toMatchObject({ status: 'not_going', respondedAt: startedAt });
    const count = await database.query(
      'select count(*)::integer as count from night_rsvps where night_id = $1',
      [nightIds[0]],
    );
    expect(count.rows).toEqual([{ count: 1 }]);
  });
});
