import type { Pool } from 'pg';

export interface HouseMemberFixture {
  readonly userId: string;
  readonly membershipId: string;
  readonly displayName: string;
  readonly sessionId: string;
  readonly sessionToken: string;
}

export interface HouseWithMemberFixture {
  readonly houseId: string;
  readonly name: string;
  readonly description: string;
  readonly member: HouseMemberFixture;
}

export interface TwoHousesWithMembers {
  readonly first: HouseWithMemberFixture;
  readonly second: HouseWithMemberFixture;
}

const world: TwoHousesWithMembers = {
  first: {
    houseId: '01941f29-7c00-7000-8000-000000000601',
    name: 'Knights at Dusk',
    description: 'Friendly games every week.',
    member: {
      userId: '01941f29-7c00-7000-8000-000000000611',
      membershipId: '01941f29-7c00-7000-8000-000000000621',
      displayName: 'Ada',
      sessionId: '01941f29-7c00-7000-8000-000000000631',
      sessionToken: 'bm-013-first-member-session-token-0001',
    },
  },
  second: {
    houseId: '01941f29-7c00-7000-8000-000000000602',
    name: 'The Long Table',
    description: 'Correspondence over coffee.',
    member: {
      userId: '01941f29-7c00-7000-8000-000000000612',
      membershipId: '01941f29-7c00-7000-8000-000000000622',
      displayName: 'Grace',
      sessionId: '01941f29-7c00-7000-8000-000000000632',
      sessionToken: 'bm-013-second-member-session-token-001',
    },
  },
};

/** [BM-013] [PR-PLAT-05] Reusable two-tenant PostgreSQL isolation world. */
export async function twoHousesWithMembers(database: Pool): Promise<TwoHousesWithMembers> {
  const client = await database.connect();
  const createdAt = new Date('2026-08-30T00:00:00.000Z');
  try {
    await client.query('begin');
    await client.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, $2, 'ada-isolation@example.test', true),
              ($3, $4, 'grace-isolation@example.test', true)`,
      [
        world.first.member.userId,
        world.first.member.displayName,
        world.second.member.userId,
        world.second.member.displayName,
      ],
    );

    for (const [house, auditId] of [
      [world.first, '01941f29-7c00-7000-8000-000000000641'],
      [world.second, '01941f29-7c00-7000-8000-000000000642'],
    ] as const) {
      await client.query(
        `insert into houses
          (id, name, slug, description, emblem_seed, time_zone, owner_membership_id,
           member_cap, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'Asia/Kolkata', null, 30, 'active', $6, $6)`,
        [
          house.houseId,
          house.name,
          `house-${house.houseId}`,
          house.description,
          `house:${house.houseId}`,
          createdAt,
        ],
      );
      await client.query(
        `insert into memberships
          (id, house_id, user_id, role, status, joined_at, created_at, updated_at)
         values ($1, $2, $3, 'owner', 'active', $4, $4, $4)`,
        [house.member.membershipId, house.houseId, house.member.userId, createdAt],
      );
      await client.query('update houses set owner_membership_id = $2 where id = $1', [
        house.houseId,
        house.member.membershipId,
      ]);
      await client.query(
        `insert into membership_audit
          (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
         values ($1, $2, $3, 'member_joined', $3, null, $4)`,
        [auditId, house.houseId, house.member.membershipId, createdAt],
      );
    }

    await client.query('commit');
    return world;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Remove this fixture's stable rows so E2E setup is rerunnable after an interrupted run. */
export async function resetTwoHousesWithMembers(database: Pool): Promise<void> {
  const houseIds = [world.first.houseId, world.second.houseId];
  const userIds = [world.first.member.userId, world.second.member.userId];
  const client = await database.connect();
  try {
    await client.query('begin');
    await client.query('delete from membership_audit where house_id = any($1::uuid[])', [houseIds]);
    await client.query(
      `update houses
          set status = 'deleted', deleted_at = now(), owner_membership_id = null
        where id = any($1::uuid[])`,
      [houseIds],
    );
    await client.query('delete from memberships where house_id = any($1::uuid[])', [houseIds]);
    await client.query('delete from houses where id = any($1::uuid[])', [houseIds]);
    await client.query('delete from users where id = any($1::uuid[])', [userIds]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
