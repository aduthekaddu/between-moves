import type { GameSeatCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameSeatRepository } from './pg-game-seat-repository';
import { PgHouseRosterRepository } from './pg-house-roster-repository';
import { PgNightAttendanceRepository } from './pg-night-attendance-repository';
import { PgOpenSeatReadRepository } from './pg-open-seat-read-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const now = new Date('2026-09-02T08:00:00.000Z');
const seasonId = id(1001);
const nightId = id(1003);

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function viewing(world: TwoHousesWithMembers, who: 'member' | 'nonOwner', house = world.first) {
  return fakeAuthorizationContext({ houseId: house.houseId, viewerId: world.first[who].userId });
}

async function createActiveSeason(database: Pool, houseId: string): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [seasonId, houseId, now],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [id(1002), seasonId, now],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, now, new Date('2026-09-30T08:00:00.000Z')],
  );
}

function seat(
  suffix: number,
  overrides: Partial<Extract<GameSeatCreationInput, { mode: 'correspondence' }>> = {},
): GameSeatCreationInput {
  return {
    gameId: id(suffix),
    openSeatId: id(suffix + 1),
    mode: 'correspondence',
    clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
    offeredColor: 'white',
    creatorColor: 'black',
    intendedMembershipId: null,
    idempotencyKey: null,
    idempotencyPayload: '{}',
    createdAt: new Date(now.getTime() + suffix),
    expiresAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

async function insertInvitation(
  database: Pool,
  world: TwoHousesWithMembers,
  suffix: number,
  values: {
    readonly email?: string;
    readonly expiresAt?: Date;
    readonly useLimit?: number;
    readonly useCount?: number;
    readonly revokedAt?: Date;
    readonly createdAt?: Date;
  } = {},
): Promise<string> {
  const invitationId = id(suffix);
  await database.query(
    `insert into invitations
      (id, house_id, token_digest, intended_email, expires_at, use_limit, use_count,
       revoked_at, creator_membership_id, created_at)
     values ($1, $2, decode(lpad(to_hex($3::int), 64, '0'), 'hex'), $4, $5, $6, $7, $8, $9, $10)`,
    [
      invitationId,
      world.first.houseId,
      suffix,
      values.email ?? null,
      values.expiresAt ?? new Date('2026-09-09T08:00:00.000Z'),
      values.useLimit ?? 5,
      values.useCount ?? 0,
      values.revokedAt ?? null,
      world.first.member.membershipId,
      values.createdAt ?? now,
    ],
  );
  return invitationId;
}

describe('PostgreSQL House roster, Invitation, open seat, and attendance reads', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const roster = new PgHouseRosterRepository(database);
  const seats = new PgGameSeatRepository(database);
  const openSeats = new PgOpenSeatReadRepository(database);
  const attendance = new PgNightAttendanceRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-015] lists active Members Owner first, then Stewards, then Members by name', async () => {
    const result = await roster.readRoster(viewing(world, 'nonOwner'));

    expect(result).toEqual({
      houseId: world.first.houseId,
      memberCap: 30,
      viewerMembershipId: world.first.nonOwner.membershipId,
      viewerRole: 'member',
      members: [
        expect.objectContaining({
          membershipId: world.first.member.membershipId,
          displayName: 'Ada',
          role: 'owner',
        }),
        expect.objectContaining({
          membershipId: world.switchingMember.firstMembershipId,
          displayName: 'Mira',
          role: 'steward',
        }),
        expect.objectContaining({
          membershipId: world.first.nonOwner.membershipId,
          displayName: 'Bea',
          role: 'member',
        }),
      ],
    });
    expect(result?.members[0]?.joinedAt).toBeInstanceOf(Date);
  });

  it('[BM-015] [DR-MEM-04] hides the roster across Houses and after the viewer leaves', async () => {
    await expect(roster.readRoster(viewing(world, 'member', world.second))).resolves.toBeNull();

    await database.query(`update memberships set status = 'left', left_at = now() where id = $1`, [
      world.first.nonOwner.membershipId,
    ]);
    await expect(roster.readRoster(viewing(world, 'nonOwner'))).resolves.toBeNull();
    const ownerView = await roster.readRoster(viewing(world, 'member'));
    expect(ownerView?.members.map((member) => member.displayName)).toEqual(['Ada', 'Mira']);
  });

  it('[BM-014] lists only usable Invitations, newest first, to an Owner', async () => {
    const shared = await insertInvitation(database, world, 1101, { useLimit: 4, useCount: 1 });
    const single = await insertInvitation(database, world, 1102, {
      email: 'new-friend@example.test',
      useLimit: 1,
      createdAt: new Date('2026-09-02T09:00:00.000Z'),
    });
    await insertInvitation(database, world, 1103, { revokedAt: now });
    await insertInvitation(database, world, 1104, {
      expiresAt: new Date('2026-09-02T09:30:00.000Z'),
    });
    await insertInvitation(database, world, 1105, { useLimit: 2, useCount: 2 });

    const pending = await roster.listPending(
      viewing(world, 'member'),
      new Date('2026-09-02T10:00:00.000Z'),
    );

    expect(pending).toEqual([
      {
        invitationId: single,
        kind: 'single',
        intendedEmail: 'new-friend@example.test',
        createdAt: new Date('2026-09-02T09:00:00.000Z'),
        expiresAt: new Date('2026-09-09T08:00:00.000Z'),
        useLimit: 1,
        useCount: 0,
        creatorName: 'Ada',
      },
      {
        invitationId: shared,
        kind: 'shared',
        intendedEmail: null,
        createdAt: now,
        expiresAt: new Date('2026-09-09T08:00:00.000Z'),
        useLimit: 4,
        useCount: 1,
        creatorName: 'Ada',
      },
    ]);
  });

  it('[BM-014] [DR-MEM-04] never lists Invitations to a Member or across Houses', async () => {
    await insertInvitation(database, world, 1106);

    await expect(roster.listPending(viewing(world, 'nonOwner'), now)).resolves.toEqual([]);
    await expect(roster.listPending(viewing(world, 'member', world.second), now)).resolves.toEqual(
      [],
    );
  });

  describe('with an active Season', () => {
    beforeEach(async () => {
      await createActiveSeason(database, world.first.houseId);
    });

    it('[BM-023] lists open seats to every Member and direct challenges only to their pair', async () => {
      await seats.create(viewing(world, 'member'), seat(1201));
      await seats.create(
        viewing(world, 'member'),
        seat(1211, {
          offeredColor: 'any',
          creatorColor: 'white',
          intendedMembershipId: world.first.nonOwner.membershipId,
        }),
      );

      const forChallenged = await openSeats.listOpenSeats(viewing(world, 'nonOwner'), now);
      expect(forChallenged).toEqual([
        {
          gameId: id(1201),
          openSeatId: id(1202),
          mode: 'correspondence',
          clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
          nightId: null,
          offeredColor: 'white',
          creator: { membershipId: world.first.member.membershipId, name: 'Ada' },
          intended: null,
          createdAt: new Date(now.getTime() + 1201),
          expiresAt: new Date('2026-09-09T08:00:00.000Z'),
          viewerIsCreator: false,
          viewerMayAccept: true,
        },
        expect.objectContaining({
          gameId: id(1211),
          offeredColor: 'any',
          intended: { membershipId: world.first.nonOwner.membershipId, name: 'Bea' },
          viewerIsCreator: false,
          viewerMayAccept: true,
        }),
      ]);

      const forCreator = await openSeats.listOpenSeats(viewing(world, 'member'), now);
      expect(forCreator.map((listing) => [listing.gameId, listing.viewerMayAccept])).toEqual([
        [id(1201), false],
        [id(1211), false],
      ]);

      const bystander = fakeAuthorizationContext({
        houseId: world.first.houseId,
        viewerId: world.switchingMember.userId,
      });
      const forBystander = await openSeats.listOpenSeats(bystander, now);
      expect(forBystander.map((listing) => listing.gameId)).toEqual([id(1201)]);
    });

    it('[BM-023] drops accepted, expired, and cross-House seats, and live seats after their Night', async () => {
      await seats.create(viewing(world, 'member'), seat(1221));
      await seats.create(viewing(world, 'member'), seat(1231));
      await database.query(
        `insert into house_nights (id, house_id, season_id, scheduled_start, scheduled_end,
          state, started_at) values ($1,$2,$3,$4,$5,'live',$4)`,
        [nightId, world.first.houseId, seasonId, now, new Date('2026-09-02T11:00:00.000Z')],
      );
      await seats.create(viewing(world, 'member'), {
        ...seat(1241),
        mode: 'live',
        nightId,
        clockPolicy: { kind: 'live', initialMs: 600_000, incrementMs: 5_000 },
      });
      await database.query(`update open_seats set state = 'accepted' where id = $1`, [id(1222)]);

      const live = await openSeats.listOpenSeats(viewing(world, 'nonOwner'), now);
      expect(live.map((listing) => listing.gameId)).toEqual([id(1231), id(1241)]);
      expect(live[1]).toMatchObject({
        mode: 'live',
        nightId,
        clockPolicy: { kind: 'live', initialMs: 600_000, incrementMs: 5_000 },
      });

      await database.query(`update house_nights set state = 'ended', ended_at = $2 where id = $1`, [
        nightId,
        new Date('2026-09-02T10:00:00.000Z'),
      ]);
      await expect(
        openSeats.listOpenSeats(viewing(world, 'nonOwner'), new Date('2026-09-09T08:00:00.000Z')),
      ).resolves.toEqual([]);
      await expect(
        openSeats.listOpenSeats(viewing(world, 'member', world.second), now),
      ).resolves.toEqual([]);
    });

    it('[BM-036] reads the viewer attendance only for their own membership', async () => {
      await database.query(
        `insert into house_nights (id, house_id, season_id, scheduled_start, scheduled_end,
          state, started_at) values ($1,$2,$3,$4,$5,'live',$4)`,
        [nightId, world.first.houseId, seasonId, now, new Date('2026-09-02T11:00:00.000Z')],
      );
      await expect(
        attendance.readViewerAttendance(viewing(world, 'nonOwner'), nightId),
      ).resolves.toBeNull();

      await attendance.join(viewing(world, 'nonOwner'), {
        attendanceId: id(1301),
        eventId: id(1302),
        nightId,
        joinedAt: now,
      });

      await expect(
        attendance.readViewerAttendance(viewing(world, 'nonOwner'), nightId),
      ).resolves.toMatchObject({
        attendanceId: id(1301),
        membershipId: world.first.nonOwner.membershipId,
        currentJoinedAt: now,
        accumulatedSeconds: 0,
        qualifiedAt: null,
      });
      await expect(
        attendance.readViewerAttendance(viewing(world, 'member'), nightId),
      ).resolves.toBeNull();
      await expect(
        attendance.readViewerAttendance(viewing(world, 'member', world.second), nightId),
      ).resolves.toBeNull();
    });
  });
});
