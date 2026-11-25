import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNightRepository } from './pg-night-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
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

integration('PostgreSQL Between Moves Night schedule', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const seasons = new PgSeasonRepository(database);
  const nights = new PgNightRepository(database);
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

  it('[BM-020] [DR-SEASON-03] materializes and reads four weekly House-local Nights', async () => {
    const member = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });

    await expect(nights.list(member)).resolves.toEqual([
      expect.objectContaining({
        nightId: nightIds[0],
        scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
      }),
      expect.objectContaining({
        nightId: nightIds[1],
        scheduledStart: new Date('2026-09-11T14:00:00.000Z'),
      }),
      expect.objectContaining({
        nightId: nightIds[2],
        scheduledStart: new Date('2026-09-18T14:00:00.000Z'),
      }),
      expect.objectContaining({
        nightId: nightIds[3],
        scheduledStart: new Date('2026-09-25T14:00:00.000Z'),
      }),
    ]);
  });

  it('[BM-020] [DR-NIGHT-03] audits Steward reschedule and Owner cancellation', async () => {
    const steward = fakeAuthorizationContext({
      viewerId: world.switchingMember.userId,
      houseId: world.first.houseId,
    });
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    const scheduledStart = new Date('2026-09-05T14:30:00.000Z');
    const scheduledEnd = new Date('2026-09-05T16:30:00.000Z');

    await expect(
      nights.change(steward, {
        nightId: nightIds[0],
        auditId: '01941f29-7c00-7000-8000-000000000911',
        command: { kind: 'reschedule', scheduledStart, scheduledEnd },
        changedAt: createdAt,
      }),
    ).resolves.toMatchObject({ changedNow: true, night: { scheduledStart, scheduledEnd } });
    await expect(
      nights.change(owner, {
        nightId: nightIds[1],
        auditId: '01941f29-7c00-7000-8000-000000000912',
        command: { kind: 'cancel' },
        changedAt: createdAt,
      }),
    ).resolves.toMatchObject({ changedNow: true, night: { state: 'cancelled' } });
    await expect(
      nights.change(owner, {
        nightId: nightIds[1],
        auditId: '01941f29-7c00-7000-8000-000000000913',
        command: { kind: 'cancel' },
        changedAt: createdAt,
      }),
    ).resolves.toMatchObject({ changedNow: false, night: { state: 'cancelled' } });

    const audit = await database.query(
      `select action, actor_membership_id::text as actor_membership_id
         from night_audit where house_id = $1 order by id`,
      [world.first.houseId],
    );
    expect(audit.rows).toEqual([
      { action: 'rescheduled', actor_membership_id: world.switchingMember.firstMembershipId },
      { action: 'cancelled', actor_membership_id: world.first.member.membershipId },
    ]);
  });

  it('[BM-020] [DR-NIGHT-03] refuses a clashing start and a started Night, and audits only real changes', async () => {
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    const reschedule = (
      nightId: string,
      auditId: string,
      scheduledStart: Date,
      scheduledEnd: Date,
    ) =>
      nights.change(owner, {
        nightId,
        auditId,
        command: { kind: 'reschedule', scheduledStart, scheduledEnd },
        changedAt: createdAt,
      });

    // Night 2 already starts at this instant
    await expect(
      reschedule(
        nightIds[0],
        '01941f29-7c00-7000-8000-000000000941',
        new Date('2026-09-11T14:00:00.000Z'),
        new Date('2026-09-11T16:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });

    // the same times again change nothing and write no audit row
    await expect(
      reschedule(
        nightIds[0],
        '01941f29-7c00-7000-8000-000000000942',
        new Date('2026-09-04T14:00:00.000Z'),
        new Date('2026-09-04T16:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ changedNow: false });

    await database.query(`update house_nights set state = 'live', started_at = $2 where id = $1`, [
      nightIds[2],
      new Date('2026-09-18T14:00:00.000Z'),
    ]);
    await expect(
      reschedule(
        nightIds[2],
        '01941f29-7c00-7000-8000-000000000943',
        new Date('2026-09-19T14:00:00.000Z'),
        new Date('2026-09-19T16:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      nights.change(owner, {
        nightId: nightIds[2],
        auditId: '01941f29-7c00-7000-8000-000000000944',
        command: { kind: 'cancel' },
        changedAt: createdAt,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    await expect(
      database.query('select count(*)::int as count from night_audit'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('[BM-020] [DR-PERM-01] rejects a Member at the repository authority seam', async () => {
    const member = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    await expect(
      nights.change(member, {
        nightId: nightIds[0],
        auditId: '01941f29-7c00-7000-8000-000000000914',
        command: { kind: 'cancel' },
        changedAt: createdAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it("[BM-020] [DR-SEC-01] cannot edit another House's Night", async () => {
    const otherOwner = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    await expect(
      nights.change(otherOwner, {
        nightId: nightIds[0],
        auditId: '01941f29-7c00-7000-8000-000000000915',
        command: { kind: 'cancel' },
        changedAt: createdAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const row = await database.query('select state from house_nights where id = $1', [nightIds[0]]);
    expect(row.rows).toEqual([{ state: 'scheduled' }]);
  });

  it('[BM-020] [DR-SEC-01] enforces House consistency across Night foreign keys', async () => {
    await expect(
      database.query(
        `insert into house_nights
           (id, house_id, season_id, scheduled_start, scheduled_end)
         values ($1, $2, $3, $4, $5)`,
        [
          '01941f29-7c00-7000-8000-000000000921',
          world.second.houseId,
          seasonId,
          new Date('2026-10-09T14:00:00.000Z'),
          new Date('2026-10-09T16:00:00.000Z'),
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'house_nights_season_house_fk' });

    await expect(
      database.query(
        `insert into house_nights
           (id, house_id, season_id, scheduled_start, scheduled_end, host_membership_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          '01941f29-7c00-7000-8000-000000000922',
          world.first.houseId,
          seasonId,
          new Date('2026-10-09T14:00:00.000Z'),
          new Date('2026-10-09T16:00:00.000Z'),
          world.second.member.membershipId,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'house_nights_host_house_fk' });

    await expect(
      database.query(
        `insert into night_audit
           (id, house_id, night_id, actor_membership_id, action,
            previous_scheduled_start, previous_scheduled_end,
            scheduled_start, scheduled_end, created_at)
         select $1, $2, id, $3, 'cancelled',
                scheduled_start, scheduled_end, scheduled_start, scheduled_end, $4
           from house_nights where id = $5`,
        [
          '01941f29-7c00-7000-8000-000000000923',
          world.second.houseId,
          world.second.member.membershipId,
          createdAt,
          nightIds[0],
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'night_audit_night_house_fk' });

    await expect(
      database.query(
        `insert into night_audit
           (id, house_id, night_id, actor_membership_id, action,
            previous_scheduled_start, previous_scheduled_end,
            scheduled_start, scheduled_end, created_at)
         select $1, house_id, id, $2, 'cancelled',
                scheduled_start, scheduled_end, scheduled_start, scheduled_end, $3
           from house_nights where id = $4`,
        [
          '01941f29-7c00-7000-8000-000000000924',
          world.second.member.membershipId,
          createdAt,
          nightIds[0],
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'night_audit_actor_house_fk' });
  });
});
