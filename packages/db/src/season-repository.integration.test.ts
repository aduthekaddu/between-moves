import type { AuthorizationContext } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const firstSeasonId = '01941f29-7c00-7000-8000-000000000801';
const secondSeasonId = '01941f29-7c00-7000-8000-000000000802';
const firstCharterId = '01941f29-7c00-7000-8000-000000000811';
const secondCharterId = '01941f29-7c00-7000-8000-000000000812';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000821',
  '01941f29-7c00-7000-8000-000000000822',
  '01941f29-7c00-7000-8000-000000000823',
  '01941f29-7c00-7000-8000-000000000824',
] as const;
const otherNightIds = [
  '01941f29-7c00-7000-8000-000000000825',
  '01941f29-7c00-7000-8000-000000000826',
  '01941f29-7c00-7000-8000-000000000827',
  '01941f29-7c00-7000-8000-000000000828',
] as const;
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startsAt = new Date('2026-09-04T12:00:00.000Z');
const endsAt = new Date('2026-10-02T12:00:00.000Z');
const nightRecurrence = { weekday: 5, localTime: '19:30', count: 4 } as const;
const pointsRecipe = {
  completedGame: 1,
  win: 2,
  draw: 1,
  nightAttendance: 1,
  publishedPuzzle: 1,
  caps: { games: 8, nights: 4, puzzles: 2 },
} as const;

function contextFor(house: TwoHousesWithMembers['first']): AuthorizationContext {
  return fakeAuthorizationContext({ viewerId: house.member.userId, houseId: house.houseId });
}

async function prepareDraft(
  repository: PgSeasonRepository,
  context: AuthorizationContext,
  seasonId: string,
  charterId: string,
) {
  await repository.draft(context, {
    seasonId,
    title: 'Autumn tables',
    idempotencyKey: null,
    createdAt,
  });
  await repository.draftCharter(context, {
    charterId,
    seasonId,
    correspondencePaceHours: 24,
    nightRecurrence,
    pointsRecipe,
    createdAt,
  });
}

describe('PostgreSQL Season repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgSeasonRepository(database);
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

  it('[BM-018] [DR-SEASON-01..05] drafts, versions, and atomically publishes a Charter', async () => {
    const context = contextFor(world.first);
    await expect(
      repository.draft(context, {
        seasonId: firstSeasonId,
        title: 'Autumn tables',
        idempotencyKey: 'draft-first',
        createdAt,
      }),
    ).resolves.toEqual({
      seasonId: firstSeasonId,
      houseId: world.first.houseId,
      state: 'draft',
      createdNow: true,
    });
    await expect(
      repository.draft(context, {
        seasonId: secondSeasonId,
        title: 'Autumn tables',
        idempotencyKey: 'draft-first',
        createdAt,
      }),
    ).resolves.toEqual({
      seasonId: firstSeasonId,
      houseId: world.first.houseId,
      state: 'draft',
      createdNow: false,
    });
    await expect(
      repository.draft(context, {
        seasonId: secondSeasonId,
        title: 'A different draft',
        idempotencyKey: 'draft-first',
        createdAt,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'idempotency_conflict' }));
    await expect(
      repository.draftCharter(context, {
        charterId: firstCharterId,
        seasonId: firstSeasonId,
        correspondencePaceHours: 24,
        nightRecurrence,
        pointsRecipe,
        createdAt,
      }),
    ).resolves.toEqual({ seasonId: firstSeasonId, version: 1 });
    await expect(
      repository.draftCharter(context, {
        charterId: secondCharterId,
        seasonId: firstSeasonId,
        correspondencePaceHours: 48,
        nightRecurrence: { ...nightRecurrence, localTime: '20:00' },
        pointsRecipe,
        createdAt,
      }),
    ).resolves.toEqual({ seasonId: firstSeasonId, version: 2 });

    await expect(
      repository.publish(context, {
        seasonId: firstSeasonId,
        title: 'Published Autumn tables',
        startsAt,
        endsAt,
        publishedAt: createdAt,
        nightIds,
      }),
    ).resolves.toEqual({
      seasonId: firstSeasonId,
      houseId: world.first.houseId,
      state: 'active',
      publishedCharterVersion: 2,
      activatedNow: true,
      actorMembershipId: world.first.member.membershipId,
    });
    await expect(
      repository.publish(context, {
        seasonId: firstSeasonId,
        title: 'Ignored replay title',
        startsAt,
        endsAt,
        publishedAt: new Date('2026-09-01T12:01:00.000Z'),
        nightIds,
      }),
    ).resolves.toEqual({
      seasonId: firstSeasonId,
      houseId: world.first.houseId,
      state: 'active',
      publishedCharterVersion: 2,
      activatedNow: false,
      actorMembershipId: world.first.member.membershipId,
    });
    await expect(
      repository.draft(context, {
        seasonId: secondSeasonId,
        title: 'Autumn tables',
        idempotencyKey: 'draft-first',
        createdAt,
      }),
    ).resolves.toEqual({
      seasonId: firstSeasonId,
      houseId: world.first.houseId,
      state: 'draft',
      createdNow: false,
    });

    const persisted = await database.query(
      `select s.state, s.starts_at, s.ends_at, s.published_charter_version,
              c.version, c.correspondence_pace_hours, c.published_at, c.points_recipe
         from seasons s
         join season_charters c
           on c.season_id = s.id and c.version = s.published_charter_version
        where s.id = $1`,
      [firstSeasonId],
    );
    expect(persisted.rows).toEqual([
      {
        state: 'active',
        starts_at: startsAt,
        ends_at: endsAt,
        published_charter_version: 2,
        version: 2,
        correspondence_pace_hours: 48,
        published_at: createdAt,
        points_recipe: pointsRecipe,
      },
    ]);
    const nights = await database.query<{ count: number }>(
      'select count(*)::integer as count from house_nights where season_id = $1',
      [firstSeasonId],
    );
    expect(nights.rows).toEqual([{ count: 4 }]);

    await expect(repository.readCurrent(context)).resolves.toEqual({
      seasonId: firstSeasonId,
      title: 'Published Autumn tables',
      state: 'active',
      startsAt,
      endsAt,
      charter: {
        version: 2,
        correspondencePaceHours: 48,
        nightRecurrence: { ...nightRecurrence, localTime: '20:00' },
        pointsRecipe,
      },
    });
  });

  it('[BM-019] returns no current Season for another House', async () => {
    await prepareDraft(repository, contextFor(world.first), firstSeasonId, firstCharterId);

    await expect(repository.readCurrent(contextFor(world.second))).resolves.toBeNull();
  });

  it('[BM-019] [DR-SEC-01] rechecks active membership on the current Season read', async () => {
    await prepareDraft(repository, contextFor(world.first), firstSeasonId, firstCharterId);
    const memberContext = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    await expect(repository.readCurrent(memberContext)).resolves.toMatchObject({
      seasonId: firstSeasonId,
    });

    await database.query(
      `update memberships set status = 'removed', left_at = $2, updated_at = $2 where id = $1`,
      [world.first.nonOwner.membershipId, createdAt],
    );

    await expect(repository.readCurrent(memberContext)).resolves.toBeNull();
  });

  it('[BM-018] [DR-SEASON-04] rejects a second active Season in the same House', async () => {
    const context = contextFor(world.first);
    await prepareDraft(repository, context, firstSeasonId, firstCharterId);
    await prepareDraft(repository, context, secondSeasonId, secondCharterId);
    await repository.publish(context, {
      seasonId: firstSeasonId,
      title: 'First',
      startsAt,
      endsAt,
      publishedAt: createdAt,
      nightIds,
    });

    await expect(
      repository.publish(context, {
        seasonId: secondSeasonId,
        title: 'Second',
        startsAt,
        endsAt,
        publishedAt: createdAt,
        nightIds: otherNightIds,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'conflict' }));
  });

  it('[BM-018] [DR-SEASON-04] permits at most one concurrent activation per House', async () => {
    const context = contextFor(world.first);
    await prepareDraft(repository, context, firstSeasonId, firstCharterId);
    await prepareDraft(repository, context, secondSeasonId, secondCharterId);

    const attempts = await Promise.allSettled([
      repository.publish(context, {
        seasonId: firstSeasonId,
        title: 'First',
        startsAt,
        endsAt,
        publishedAt: createdAt,
        nightIds,
      }),
      repository.publish(context, {
        seasonId: secondSeasonId,
        title: 'Second',
        startsAt,
        endsAt,
        publishedAt: createdAt,
        nightIds: otherNightIds,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const active = await database.query<{ count: number }>(
      `select count(*)::integer as count
         from seasons
        where house_id = $1 and state in ('active', 'closing')`,
      [world.first.houseId],
    );
    expect(active.rows).toEqual([{ count: 1 }]);
  });

  it('[BM-018] [DR-SEC-01] cannot mutate a Season through another House context', async () => {
    const firstContext = contextFor(world.first);
    const secondContext = contextFor(world.second);
    await prepareDraft(repository, firstContext, firstSeasonId, firstCharterId);

    await expect(
      repository.draftCharter(secondContext, {
        charterId: secondCharterId,
        seasonId: firstSeasonId,
        correspondencePaceHours: 48,
        nightRecurrence,
        pointsRecipe,
        createdAt,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'not_found' }));
    await expect(
      repository.publish(secondContext, {
        seasonId: firstSeasonId,
        title: 'Crossed',
        startsAt,
        endsAt,
        publishedAt: createdAt,
        nightIds,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'not_found' }));

    const row = await database.query('select state, title from seasons where id = $1', [
      firstSeasonId,
    ]);
    expect(row.rows).toEqual([{ state: 'draft', title: 'Autumn tables' }]);
  });

  it('[BM-018] [DR-PERM-01] rejects a Member even with a matching House context', async () => {
    const memberContext = fakeAuthorizationContext({
      viewerId: world.first.nonOwner.userId,
      houseId: world.first.houseId,
    });
    await expect(
      repository.draft(memberContext, {
        seasonId: firstSeasonId,
        title: 'Nope',
        idempotencyKey: null,
        createdAt,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'not_found' }));
  });

  it('[BM-018] [DR-SEASON-04] concurrent transactions are arbitrated by the partial index', async () => {
    const context = contextFor(world.first);
    await prepareDraft(repository, context, firstSeasonId, firstCharterId);
    await prepareDraft(repository, context, secondSeasonId, secondCharterId);
    const first = await database.connect();
    const second = await database.connect();
    const activate = `update seasons
                         set state = $2, starts_at = $3, ends_at = $4,
                             published_charter_version = 1, updated_at = $5
                       where id = $1`;
    try {
      await first.query('begin');
      await second.query('begin');
      await first.query(activate, [firstSeasonId, 'active', startsAt, endsAt, createdAt]);
      const secondActivation = second
        .query(activate, [secondSeasonId, 'closing', startsAt, endsAt, createdAt])
        .then(
          () => ({ status: 'fulfilled' as const, error: null }),
          (error: unknown) => ({ status: 'rejected' as const, error }),
        );
      await new Promise<void>((resolve) => setImmediate(resolve));
      await first.query('commit');

      const outcome = await secondActivation;
      expect(outcome.status).toBe('rejected');
      expect(outcome.error).toMatchObject({
        code: '23505',
        constraint: 'seasons_one_active_or_closing_per_house',
      });
    } finally {
      await first.query('rollback').catch(() => undefined);
      await second.query('rollback').catch(() => undefined);
      first.release();
      second.release();
    }

    const rows = await database.query<{ state: string }>(
      `select state from seasons
        where house_id = $1 and state in ('active', 'closing')`,
      [world.first.houseId],
    );
    expect(rows.rows).toEqual([{ state: 'active' }]);
  });
});
