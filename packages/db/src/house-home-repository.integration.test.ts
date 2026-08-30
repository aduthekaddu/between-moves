import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgHouseHomeRepository } from './pg-house-home-repository';
import { migrateDown, migrateUp } from './migrations';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

integration('House home persistence and tenant isolation', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgHouseHomeRepository(database);
  let world: TwoHousesWithMembers;

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-013] [DR-HOUSE-01] returns House details and the active Member role', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });

    await expect(repository.read(context)).resolves.toEqual({
      houseId: world.first.houseId,
      name: world.first.name,
      description: world.first.description,
      emblemSeed: `house:${world.first.houseId}`,
      timeZone: 'Asia/Kolkata',
      membershipRole: 'owner',
    });
  });

  const houseScopedReads = [
    {
      name: 'House home read',
      attempt: (repository: PgHouseHomeRepository, world: TwoHousesWithMembers) =>
        repository.read(
          fakeAuthorizationContext({
            houseId: world.second.houseId,
            viewerId: world.first.member.userId,
          }),
        ),
    },
  ] as const;

  it.each(houseScopedReads)(
    '[BM-013] [PR-PLAT-05] [DR-MEM-04] denies cross-House $name',
    async ({ attempt }) => {
      await expect(attempt(repository, world)).resolves.toBeNull();
    },
  );

  it('[BM-013] [DR-MEM-04] denies a stale context after the membership becomes inactive', async () => {
    await database.query(
      `update memberships set status = 'left', left_at = now()
        where id = $1`,
      [world.first.member.membershipId],
    );

    await expect(
      repository.read(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.member.userId,
        }),
      ),
    ).resolves.toBeNull();
  });
});
