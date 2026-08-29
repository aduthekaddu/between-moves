import type { HouseCreationInput } from '@between-moves/domain';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgHouseCreationRepository } from './pg-house-creation-repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const ownerUserId = '01941f29-7c00-7000-8000-000000000101';

function input(suffix = '201'): HouseCreationInput {
  return {
    houseId: `01941f29-7c00-7000-8000-000000000${suffix}`,
    ownerMembershipId: `01941f29-7c00-7000-8000-000000000${Number(suffix) + 1}`,
    auditId: `01941f29-7c00-7000-8000-000000000${Number(suffix) + 2}`,
    ownerUserId,
    name: 'Knights at Dusk',
    slug: `01941f29-7c00-7000-8000-000000000${suffix}`,
    description: 'Weekly games',
    emblemSeed: `house:01941f29-7c00-7000-8000-000000000${suffix}`,
    timeZone: 'Asia/Calcutta',
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
  };
}

integration('House creation persistence', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const repository = new PgHouseCreationRepository(database);

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Ada', 'ada-house@example.test', true)`,
      [ownerUserId],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-011] [DR-HOUSE-01..02] atomically creates a House, its sole Owner, and audit row', async () => {
    const creation = input();

    await expect(repository.create(creation)).resolves.toEqual({
      houseId: creation.houseId,
      ownerMembershipId: creation.ownerMembershipId,
      slug: creation.slug,
      emblemSeed: creation.emblemSeed,
      timeZone: creation.timeZone,
    });

    const result = await database.query(
      `select h.id::text as house_id, h.name, h.slug::text, h.description,
              h.emblem_seed, h.time_zone, h.owner_membership_id::text,
              h.member_cap, h.status,
              m.user_id::text, m.role, m.status as membership_status,
              a.action, a.actor_membership_id::text, a.target_membership_id::text,
              a.metadata
         from houses h
         join memberships m on m.id = h.owner_membership_id
         join membership_audit a on a.house_id = h.id
        where h.id = $1`,
      [creation.houseId],
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        house_id: creation.houseId,
        name: creation.name,
        slug: creation.slug,
        description: creation.description,
        emblem_seed: creation.emblemSeed,
        time_zone: creation.timeZone,
        owner_membership_id: creation.ownerMembershipId,
        member_cap: 30,
        status: 'active',
        user_id: ownerUserId,
        role: 'owner',
        membership_status: 'active',
        action: 'member_joined',
        actor_membership_id: creation.ownerMembershipId,
        target_membership_id: creation.ownerMembershipId,
        metadata: null,
      }),
    ]);
  });

  it('[BM-011] [DR-MEM-01] rejects a duplicate (House, user) membership', async () => {
    const creation = input('211');
    await repository.create(creation);

    await expect(
      database.query(
        `insert into memberships (id, house_id, user_id, role, status)
         values ($1, $2, $3, 'member', 'active')`,
        ['01941f29-7c00-7000-8000-000000000214', creation.houseId, ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('[BM-011] rolls back every row when creation cannot complete', async () => {
    const existing = input('221');
    const creation = { ...input('224'), slug: existing.slug };
    await repository.create(existing);

    await expect(repository.create(creation)).rejects.toMatchObject({ code: '23505' });

    const counts = await database.query(
      `select
         (select count(*)::integer from memberships where id = $1) as memberships,
         (select count(*)::integer from membership_audit where id = $2) as audits`,
      [creation.ownerMembershipId, creation.auditId],
    );
    expect(counts.rows).toEqual([{ memberships: 0, audits: 0 }]);
  });

  it('[BM-011] [DR-HOUSE-02] rejects an active House transaction without exactly one matching Owner', async () => {
    const client = await database.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into houses
          (id, name, slug, emblem_seed, time_zone, member_cap, status)
         values ($1, 'Ownerless', $1, 'ownerless', 'UTC', 30, 'active')`,
        ['01941f29-7c00-7000-8000-000000000231'],
      );
      await expect(client.query('commit')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('[BM-011] [DR-HOUSE-02] keeps one Owner under parallel competing writes', async () => {
    const creation = input('241');
    await repository.create(creation);
    const otherUsers = [
      '01941f29-7c00-7000-8000-000000000141',
      '01941f29-7c00-7000-8000-000000000142',
    ];
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'One', 'owner-one@example.test', true),
              ($2, 'Two', 'owner-two@example.test', true)`,
      otherUsers,
    );

    const attempts = otherUsers.map((userId, index) =>
      database.query(
        `insert into memberships (id, house_id, user_id, role, status)
         values ($1, $2, $3, 'owner', 'active')`,
        [`01941f29-7c00-7000-8000-00000000025${index}`, creation.houseId, userId],
      ),
    );
    const settled = await Promise.allSettled(attempts);

    expect(settled.every((attempt) => attempt.status === 'rejected')).toBe(true);
    const owners = await database.query<{ count: number }>(
      `select count(*)::integer as count from memberships
        where house_id = $1 and role = 'owner' and status = 'active'`,
      [creation.houseId],
    );
    expect(owners.rows).toEqual([{ count: 1 }]);
  });
});
