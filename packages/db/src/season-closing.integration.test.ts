import type { AuthorizationContext } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgSeasonRepository } from './pg-season-repository';
import { PgSeasonScoringRepository } from './pg-season-scoring-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const id = (value: number) => `01941f29-7c00-7000-8000-${String(value).padStart(12, '0')}`;
const seasonId = id(4701);
const nextSeasonId = id(4702);
const otherNextSeasonId = id(4703);
const closingEventId = id(4711);
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startsAt = new Date('2026-09-04T12:00:00.000Z');
const endsAt = new Date('2026-10-02T12:00:00.000Z');
const closingAt = new Date('2026-10-02T13:00:00.000Z');
const closedAt = new Date('2026-10-02T13:00:01.000Z');
const nightRecurrence = { weekday: 5, localTime: '19:30', count: 4 } as const;
const pointsRecipe = {
  completedGame: 1,
  win: 2,
  draw: 1,
  nightAttendance: 1,
  publishedPuzzle: 1,
  caps: { games: 8, nights: 4, puzzles: 2 },
} as const;

describe('BM-047 PostgreSQL Season closing', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgSeasonRepository(database);
  let world: TwoHousesWithMembers;
  let owner: AuthorizationContext;
  let steward: AuthorizationContext;
  let member: AuthorizationContext;
  let nextId = 4800;

  async function prepareSeason(
    context: AuthorizationContext,
    targetSeasonId: string,
    publish: boolean,
  ): Promise<void> {
    await repository.draft(context, {
      seasonId: targetSeasonId,
      title: 'Autumn tables',
      idempotencyKey: null,
      createdAt,
    });
    await repository.draftCharter(context, {
      charterId: id(nextId++),
      seasonId: targetSeasonId,
      correspondencePaceHours: 24,
      nightRecurrence,
      pointsRecipe,
      createdAt,
    });
    if (!publish) return;
    await repository.publish(context, {
      seasonId: targetSeasonId,
      title: 'Autumn tables',
      startsAt,
      endsAt,
      publishedAt: createdAt,
      nightIds: [id(nextId++), id(nextId++), id(nextId++), id(nextId++)],
    });
  }

  async function award(
    membershipId: string,
    sourceKind: string,
    points: number,
    earnedAt = createdAt,
  ): Promise<void> {
    await database.query(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id(nextId++),
        world.first.houseId,
        seasonId,
        membershipId,
        sourceKind,
        `test:${nextId}`,
        points,
        earnedAt,
      ],
    );
  }

  async function seasonRow(targetSeasonId: string) {
    const result = await database.query('select state, closed_at from seasons where id = $1', [
      targetSeasonId,
    ]);
    return result.rows[0];
  }

  async function closingEvents() {
    const result = await database.query(
      `select id::text, topic, aggregate_id::text, house_id::text, payload
         from outbox_events where topic = 'season.closing' order by created_at, id`,
    );
    return result.rows;
  }

  async function close(context: AuthorizationContext, eventId = closingEventId) {
    await repository.beginClosing(context, { seasonId, closingEventId: eventId, closingAt });
    return repository.finalize(context, { seasonId, closedAt });
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    steward = fakeAuthorizationContext({
      viewerId: world.switchingMember.userId,
      houseId: world.first.houseId,
    });
    member = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    await prepareSeason(owner, seasonId, true);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-047] moves an active Season through closing to closed with finalized standings', async () => {
    await award(world.first.member.membershipId, 'game_win', 3);
    await award(world.first.member.membershipId, 'game_played', 1);
    await award(world.first.nonOwner.membershipId, 'game_played', 1);
    await award(world.first.nonOwner.membershipId, 'night_attendance', 1);

    const closing = await repository.beginClosing(owner, {
      seasonId,
      closingEventId,
      closingAt,
    });
    const ranked = [
      { membershipId: world.first.member.membershipId, points: 4, rank: 1 },
      { membershipId: world.first.nonOwner.membershipId, points: 2, rank: 2 },
      { membershipId: world.switchingMember.firstMembershipId, points: 0, rank: 3 },
    ];
    expect(closing).toEqual({
      seasonId,
      houseId: world.first.houseId,
      state: 'closing',
      standings: ranked,
      closingNow: true,
      actorMembershipId: world.first.member.membershipId,
    });
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'closing', closed_at: null });
    await expect(closingEvents()).resolves.toEqual([
      {
        id: closingEventId,
        topic: 'season.closing',
        aggregate_id: seasonId,
        house_id: world.first.houseId,
        payload: {
          seasonId,
          actorMembershipId: world.first.member.membershipId,
          closingAt: closingAt.toISOString(),
          standings: ranked,
        },
      },
    ]);

    await expect(repository.finalize(owner, { seasonId, closedAt })).resolves.toEqual({
      seasonId,
      houseId: world.first.houseId,
      state: 'closed',
      closedAt,
      standings: ranked,
      closedNow: true,
      actorMembershipId: world.first.member.membershipId,
    });
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'closed', closed_at: closedAt });
    await expect(repository.readCurrent(member)).resolves.toBeNull();
    await expect(repository.readLatestClosed(member)).resolves.toEqual({
      seasonId,
      title: 'Autumn tables',
      state: 'closed',
      startsAt,
      endsAt,
      closedAt,
      standings: [
        { ...ranked[0], displayName: world.first.member.displayName },
        { ...ranked[1], displayName: world.first.nonOwner.displayName },
        { ...ranked[2], displayName: world.switchingMember.displayName },
      ],
    });
  });

  it('[BM-047] freezes standings so a late ledger award cannot reorder a closed Season', async () => {
    await award(world.first.nonOwner.membershipId, 'game_win', 3);
    await close(owner);
    await award(world.first.member.membershipId, 'game_win', 3);
    await award(world.first.member.membershipId, 'game_played', 1);

    const scoring = new PgSeasonScoringRepository(database);
    await expect(scoring.readStandings(member, seasonId)).resolves.toEqual({
      houseId: world.first.houseId,
      seasonId,
      finalized: true,
      standings: [
        { membershipId: world.first.nonOwner.membershipId, points: 3 },
        { membershipId: world.first.member.membershipId, points: 0 },
        { membershipId: world.switchingMember.firstMembershipId, points: 0 },
      ],
    });
    await expect(
      database.query('update season_final_standings set points = 99 where season_id = $1', [
        seasonId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('[BM-047] freezes only points earned by the closing instant', async () => {
    await award(world.first.member.membershipId, 'game_played', 1, closingAt);
    await award(
      world.first.nonOwner.membershipId,
      'game_win',
      3,
      new Date(closingAt.getTime() + 1),
    );

    await expect(close(owner)).resolves.toMatchObject({
      standings: [
        { membershipId: world.first.member.membershipId, points: 1, rank: 1 },
        { membershipId: world.first.nonOwner.membershipId, points: 0, rank: 2 },
        { membershipId: world.switchingMember.firstMembershipId, points: 0, rank: 2 },
      ],
    });
  });

  it('[BM-047] rejects snapshot inserts and deletes once the Season leaves active', async () => {
    const lateMembershipId = id(4731);
    const insertLateRow = () =>
      database.query(
        `insert into season_final_standings
          (season_id, house_id, membership_id, rank, points, finalized_at)
         values ($1, $2, $3, 9, 99, $4)`,
        [seasonId, world.first.houseId, lateMembershipId, closingAt],
      );
    await repository.beginClosing(owner, { seasonId, closingEventId, closingAt });
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Late', 'late-bm047@example.test', true)`,
      [id(4732)],
    );
    await database.query(
      `insert into memberships (id, house_id, user_id, role, status, joined_at, created_at, updated_at)
       values ($1, $2, $3, 'member', 'active', $4, $4, $4)`,
      [lateMembershipId, world.first.houseId, id(4732), createdAt],
    );

    await expect(insertLateRow()).rejects.toMatchObject({ code: '55000' });
    await repository.finalize(owner, { seasonId, closedAt });
    await expect(insertLateRow()).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.query('delete from season_final_standings where season_id = $1', [seasonId]),
    ).rejects.toMatchObject({ code: '55000' });

    const snapshot = await database.query<{ membership_id: string }>(
      'select membership_id::text from season_final_standings where season_id = $1',
      [seasonId],
    );
    expect(snapshot.rows.map((row) => row.membership_id)).not.toContain(lateMembershipId);
    expect(snapshot.rowCount).toBe(3);
  });

  it('[BM-047] still removes the snapshot through the Season delete cascade', async () => {
    await close(owner);
    await database.query('delete from house_nights where season_id = $1', [seasonId]);
    await database.query('delete from seasons where id = $1', [seasonId]);

    const snapshot = await database.query('select 1 from season_final_standings');
    expect(snapshot.rowCount).toBe(0);
  });

  it('[BM-047] keeps departed Members who scored and omits departed Members who did not', async () => {
    await award(world.first.nonOwner.membershipId, 'night_attendance', 1);
    await database.query(
      `update memberships set status = 'left', left_at = now() where id = any($1::uuid[])`,
      [[world.first.nonOwner.membershipId, world.switchingMember.firstMembershipId]],
    );

    const closed = await close(owner);
    expect(closed.standings).toEqual([
      { membershipId: world.first.nonOwner.membershipId, points: 1, rank: 1 },
      { membershipId: world.first.member.membershipId, points: 0, rank: 2 },
    ]);
  });

  it('[BM-047] lets a Steward close and replays a closed Season without a second event', async () => {
    const first = await close(steward);
    expect(first).toMatchObject({
      closedNow: true,
      actorMembershipId: world.switchingMember.firstMembershipId,
    });

    await expect(
      repository.beginClosing(owner, {
        seasonId,
        closingEventId: id(4712),
        closingAt: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ state: 'closed', closingNow: false, standings: first.standings });
    await expect(
      repository.finalize(owner, { seasonId, closedAt: new Date('2026-10-03T00:00:00.000Z') }),
    ).resolves.toMatchObject({ state: 'closed', closedAt, closedNow: false });
    await expect(closingEvents()).resolves.toHaveLength(1);
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'closed', closed_at: closedAt });
  });

  it('[BM-047] resumes finalization for a Season left in closing', async () => {
    await repository.beginClosing(owner, { seasonId, closingEventId, closingAt });
    await expect(repository.readLatestClosed(member)).resolves.toMatchObject({
      seasonId,
      state: 'closing',
      closedAt: null,
      standings: expect.arrayContaining([
        expect.objectContaining({ displayName: world.first.member.displayName, rank: 1 }),
      ]),
    });

    await expect(
      repository.beginClosing(owner, { seasonId, closingEventId: id(4712), closingAt }),
    ).resolves.toMatchObject({ state: 'closing', closingNow: false });
    await expect(repository.finalize(owner, { seasonId, closedAt })).resolves.toMatchObject({
      closedNow: true,
    });
    await expect(closingEvents()).resolves.toHaveLength(1);
  });

  it('[BM-047] denies a Member and leaves the Season active', async () => {
    await expect(
      repository.beginClosing(member, { seasonId, closingEventId, closingAt }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.finalize(member, { seasonId, closedAt })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'active', closed_at: null });
    await expect(closingEvents()).resolves.toEqual([]);
  });

  it('[BM-047] denies a cross-House close without touching either House', async () => {
    const otherOwner = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    const crossedScope = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.first.houseId,
    });

    for (const context of [otherOwner, crossedScope]) {
      await expect(
        repository.beginClosing(context, { seasonId, closingEventId, closingAt }),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'active', closed_at: null });
    const snapshots = await database.query('select 1 from season_final_standings');
    expect(snapshots.rowCount).toBe(0);
  });

  it('[BM-047] rejects closing a draft and finalizing an active Season', async () => {
    const other = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    await prepareSeason(other, nextSeasonId, false);

    await expect(
      repository.beginClosing(other, {
        seasonId: nextSeasonId,
        closingEventId,
        closingAt,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.finalize(owner, { seasonId, closedAt })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(seasonRow(seasonId)).resolves.toEqual({ state: 'active', closed_at: null });
  });

  it('[BM-047] serializes concurrent closes into one snapshot and one event', async () => {
    const results = await Promise.all([
      close(owner, id(4721)),
      close(steward, id(4722)),
      close(owner, id(4723)),
    ]);

    expect(results.filter((result) => result.closedNow)).toHaveLength(1);
    expect(new Set(results.map((result) => result.closedAt.getTime())).size).toBe(1);
    await expect(closingEvents()).resolves.toHaveLength(1);
    const snapshots = await database.query<{ count: number }>(
      'select count(*)::int as count from season_final_standings where season_id = $1',
      [seasonId],
    );
    expect(snapshots.rows).toEqual([{ count: 3 }]);
  });

  it('[BM-047] keeps one active or closing Season while closing and after activation', async () => {
    await repository.beginClosing(owner, { seasonId, closingEventId, closingAt });
    await expect(
      repository.draft(owner, {
        seasonId: nextSeasonId,
        title: 'Winter tables',
        idempotencyKey: null,
        createdAt,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await repository.finalize(owner, { seasonId, closedAt });

    await prepareSeason(owner, nextSeasonId, false);
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Competing draft', 'draft', $3, $3)`,
      [otherNextSeasonId, world.first.houseId, createdAt],
    );
    await repository.draftCharter(owner, {
      charterId: id(nextId++),
      seasonId: otherNextSeasonId,
      correspondencePaceHours: 24,
      nightRecurrence,
      pointsRecipe,
      createdAt,
    });

    const publications = await Promise.allSettled(
      [nextSeasonId, otherNextSeasonId].map((targetSeasonId) =>
        repository.publish(owner, {
          seasonId: targetSeasonId,
          title: 'Winter tables',
          startsAt: new Date('2026-10-09T12:00:00.000Z'),
          endsAt: new Date('2026-11-06T12:00:00.000Z'),
          publishedAt: closedAt,
          nightIds: [id(nextId++), id(nextId++), id(nextId++), id(nextId++)],
        }),
      ),
    );

    expect(publications.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(publications.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'conflict' }),
    });
    const states = await database.query<{ state: string; count: number }>(
      `select state, count(*)::int as count from seasons
        where house_id = $1 group by state order by state`,
      [world.first.houseId],
    );
    expect(states.rows).toEqual([
      { state: 'active', count: 1 },
      { state: 'closed', count: 1 },
      { state: 'draft', count: 1 },
    ]);
    await expect(
      database.query(`update seasons set state = 'active', closed_at = null where id = $1`, [
        seasonId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
