import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgMembershipAdminRepository } from './pg-membership-admin-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

describe('BM-015 PostgreSQL membership administration', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgMembershipAdminRepository(database);
  let houses: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    houses = await twoHousesWithMembers(database);
    await database.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, $5), ($4, $2, $6, $5)`,
      [
        houses.first.nonOwner.sessionId,
        houses.first.nonOwner.userId,
        houses.first.nonOwner.sessionToken,
        '01941f29-7c00-7000-8000-000000000635',
        new Date('2026-09-30T00:00:00.000Z'),
        'bm-015-target-second-session-token-001',
      ],
    );
    await database.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, $4)`,
      [
        houses.first.member.sessionId,
        houses.first.member.userId,
        houses.first.member.sessionToken,
        new Date('2026-09-30T00:00:00.000Z'),
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-015] [DR-ID-02] [DR-PERM-01] changes a role, audits it, and invalidates prior session identifiers atomically', async () => {
    const changedAt = new Date('2026-08-30T16:00:00.000Z');
    const auditId = '01941f29-7c00-7000-8000-000000000701';

    await expect(
      repository.changeRole(
        fakeAuthorizationContext({
          viewerId: houses.first.member.userId,
          houseId: houses.first.houseId,
        }),
        {
          targetMembershipId: houses.first.nonOwner.membershipId,
          role: 'steward',
          auditId,
          changedAt,
        },
      ),
    ).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      role: 'steward',
      changed: true,
      invalidatedSessionCount: 2,
    });

    const persisted = await database.query(
      `select m.role, a.action, a.actor_membership_id::text, a.target_membership_id::text,
              a.metadata,
              (select count(*)::integer from sessions s
                where s.user_id = m.user_id and s.revoked_at = $3) as invalidated_sessions
         from memberships m
         join membership_audit a on a.id = $2
        where m.id = $1`,
      [houses.first.nonOwner.membershipId, auditId, changedAt],
    );
    expect(persisted.rows).toEqual([
      {
        role: 'steward',
        action: 'role_changed',
        actor_membership_id: houses.first.member.membershipId,
        target_membership_id: houses.first.nonOwner.membershipId,
        metadata: { from_role: 'member', to_role: 'steward' },
        invalidated_sessions: 2,
      },
    ]);
  });

  it('[BM-015] [DR-PERM-01] demotes a Steward and records the prior role', async () => {
    await database.query('update memberships set role = $2 where id = $1', [
      houses.first.nonOwner.membershipId,
      'steward',
    ]);
    const changedAt = new Date('2026-08-30T16:05:00.000Z');
    const auditId = '01941f29-7c00-7000-8000-000000000716';
    await expect(
      repository.changeRole(
        fakeAuthorizationContext({
          viewerId: houses.first.member.userId,
          houseId: houses.first.houseId,
        }),
        {
          targetMembershipId: houses.first.nonOwner.membershipId,
          role: 'member',
          auditId,
          changedAt,
        },
      ),
    ).resolves.toMatchObject({ role: 'member', changed: true, invalidatedSessionCount: 2 });

    const persisted = await database.query(
      `select m.role, a.metadata
         from memberships m join membership_audit a on a.id = $2
        where m.id = $1`,
      [houses.first.nonOwner.membershipId, auditId],
    );
    expect(persisted.rows).toEqual([
      { role: 'member', metadata: { from_role: 'steward', to_role: 'member' } },
    ]);
  });

  it('[BM-015] [DR-PERM-01] treats an already-applied role as an unaudited no-op', async () => {
    const auditId = '01941f29-7c00-7000-8000-000000000717';

    await expect(
      repository.changeRole(
        fakeAuthorizationContext({
          viewerId: houses.first.member.userId,
          houseId: houses.first.houseId,
        }),
        {
          targetMembershipId: houses.first.nonOwner.membershipId,
          role: 'member',
          auditId,
          changedAt: new Date('2026-08-30T16:06:00.000Z'),
        },
      ),
    ).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      role: 'member',
      changed: false,
      invalidatedSessionCount: 0,
    });

    const persisted = await database.query(
      `select
         (select count(*)::integer from membership_audit where id = $1) as audit_count,
         (select count(*)::integer from sessions
           where user_id = $2 and revoked_at is not null) as invalidated_sessions`,
      [auditId, houses.first.nonOwner.userId],
    );
    expect(persisted.rows).toEqual([{ audit_count: 0, invalidated_sessions: 0 }]);
  });

  it('[BM-015] [DR-MEM-06] removes a Member once and appends one audit row', async () => {
    const removedAt = new Date('2026-08-30T16:10:00.000Z');
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    const first = {
      targetMembershipId: houses.first.nonOwner.membershipId,
      auditId: '01941f29-7c00-7000-8000-000000000702',
      removedAt,
    };

    await expect(repository.remove(context, first)).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      removedNow: true,
      invalidatedSessionCount: 2,
    });
    await expect(
      repository.remove(context, {
        ...first,
        auditId: '01941f29-7c00-7000-8000-000000000703',
      }),
    ).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      removedNow: false,
      invalidatedSessionCount: 0,
    });

    const persisted = await database.query(
      `select m.status, m.left_at, a.action, a.actor_membership_id::text,
              a.target_membership_id::text,
              (select count(*)::integer from sessions s
                where s.user_id = m.user_id and s.revoked_at = $4) as invalidated_sessions,
              (select count(*)::integer from membership_audit
                where id in ($2, $3)) as audit_count
         from memberships m
         join membership_audit a on a.id = $2
        where m.id = $1`,
      [
        houses.first.nonOwner.membershipId,
        first.auditId,
        '01941f29-7c00-7000-8000-000000000703',
        removedAt,
      ],
    );
    expect(persisted.rows).toEqual([
      {
        status: 'removed',
        left_at: removedAt,
        action: 'member_removed',
        actor_membership_id: houses.first.member.membershipId,
        target_membership_id: houses.first.nonOwner.membershipId,
        invalidated_sessions: 2,
        audit_count: 1,
      },
    ]);
  });

  it('[BM-015] [DR-PERM-03] denies a Steward removing the Owner', async () => {
    await database.query('update memberships set role = $2 where id = $1', [
      houses.first.nonOwner.membershipId,
      'steward',
    ]);

    await expect(
      repository.remove(
        fakeAuthorizationContext({
          viewerId: houses.first.nonOwner.userId,
          houseId: houses.first.houseId,
        }),
        {
          targetMembershipId: houses.first.member.membershipId,
          auditId: '01941f29-7c00-7000-8000-000000000704',
          removedAt: new Date('2026-08-30T16:11:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ reason: 'protected_member' });
  });

  it('[BM-015] [DR-MEM-05] lets a non-Owner leave once and audits the departure', async () => {
    const leftAt = new Date('2026-08-30T16:20:00.000Z');
    const context = fakeAuthorizationContext({
      viewerId: houses.first.nonOwner.userId,
      houseId: houses.first.houseId,
    });
    const first = {
      auditId: '01941f29-7c00-7000-8000-000000000705',
      leftAt,
    };

    await expect(repository.leave(context, first)).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      leftNow: true,
    });
    await expect(
      repository.leave(context, {
        ...first,
        auditId: '01941f29-7c00-7000-8000-000000000706',
      }),
    ).resolves.toEqual({
      membershipId: houses.first.nonOwner.membershipId,
      leftNow: false,
    });

    const persisted = await database.query(
      `select m.status, m.left_at, a.action,
              (select count(*)::integer from membership_audit
                where id in ($2, $3)) as audit_count
         from memberships m
         join membership_audit a on a.id = $2
        where m.id = $1`,
      [houses.first.nonOwner.membershipId, first.auditId, '01941f29-7c00-7000-8000-000000000706'],
    );
    expect(persisted.rows).toEqual([
      { status: 'left', left_at: leftAt, action: 'member_left', audit_count: 1 },
    ]);
  });

  it('[BM-015] [DR-MEM-05] blocks the Owner from leaving before transfer', async () => {
    await expect(
      repository.leave(
        fakeAuthorizationContext({
          viewerId: houses.first.member.userId,
          houseId: houses.first.houseId,
        }),
        {
          auditId: '01941f29-7c00-7000-8000-000000000707',
          leftAt: new Date('2026-08-30T16:21:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const owner = await database.query(
      `select h.owner_membership_id::text, m.role, m.status,
              (select count(*)::integer from membership_audit where id = $2) as audit_count
         from houses h join memberships m on m.id = h.owner_membership_id
        where h.id = $1`,
      [houses.first.houseId, '01941f29-7c00-7000-8000-000000000707'],
    );
    expect(owner.rows).toEqual([
      {
        owner_membership_id: houses.first.member.membershipId,
        role: 'owner',
        status: 'active',
        audit_count: 0,
      },
    ]);
  });

  it('[BM-015] [DR-HOUSE-02] transfers ownership with one Owner, one audit, and affected sessions invalidated', async () => {
    const transferredAt = new Date('2026-08-30T16:30:00.000Z');
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    const input = {
      targetMembershipId: houses.first.nonOwner.membershipId,
      idempotencyKey: 'transfer-request-1',
      auditId: '01941f29-7c00-7000-8000-000000000708',
      transferredAt,
    };

    await expect(repository.transferOwnership(context, input)).resolves.toEqual({
      previousOwnerMembershipId: houses.first.member.membershipId,
      ownerMembershipId: houses.first.nonOwner.membershipId,
      changed: true,
      invalidatedSessionCount: 3,
    });
    await expect(
      repository.transferOwnership(context, {
        ...input,
        auditId: '01941f29-7c00-7000-8000-000000000709',
      }),
    ).resolves.toEqual({
      previousOwnerMembershipId: houses.first.member.membershipId,
      ownerMembershipId: houses.first.nonOwner.membershipId,
      changed: false,
      invalidatedSessionCount: 0,
    });
    await expect(
      repository.transferOwnership(context, {
        ...input,
        targetMembershipId: houses.first.member.membershipId,
        auditId: '01941f29-7c00-7000-8000-000000000718',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const persisted = await database.query(
      `select h.owner_membership_id::text,
              old_owner.role as old_owner_role,
              new_owner.role as new_owner_role,
              (select count(*)::integer from memberships
                where house_id = h.id and role = 'owner' and status = 'active') as owner_count,
              (select count(*)::integer from sessions
                where user_id in (old_owner.user_id, new_owner.user_id)
                  and revoked_at = $3) as invalidated_sessions,
              a.action, a.actor_membership_id::text, a.target_membership_id::text,
              a.metadata,
              (select count(*)::integer from membership_audit
                where id in ($2, $4)) as audit_count
         from houses h
         join memberships old_owner on old_owner.id = $5
         join memberships new_owner on new_owner.id = h.owner_membership_id
         join membership_audit a on a.id = $2
        where h.id = $1`,
      [
        houses.first.houseId,
        input.auditId,
        transferredAt,
        '01941f29-7c00-7000-8000-000000000709',
        houses.first.member.membershipId,
      ],
    );
    expect(persisted.rows).toEqual([
      expect.objectContaining({
        owner_membership_id: houses.first.nonOwner.membershipId,
        old_owner_role: 'member',
        new_owner_role: 'owner',
        owner_count: 1,
        invalidated_sessions: 3,
        action: 'ownership_transferred',
        actor_membership_id: houses.first.member.membershipId,
        target_membership_id: houses.first.nonOwner.membershipId,
        audit_count: 1,
      }),
    ]);
    expect(persisted.rows[0]?.metadata).toMatchObject({
      previous_owner_membership_id: houses.first.member.membershipId,
      owner_membership_id: houses.first.nonOwner.membershipId,
    });
    expect(persisted.rows[0]?.metadata.idempotency_key_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('[BM-015] [DR-MEM-04] denies every administration path through another House context', async () => {
    const context = fakeAuthorizationContext({
      viewerId: houses.second.member.userId,
      houseId: houses.first.houseId,
    });
    const at = new Date('2026-08-30T16:40:00.000Z');
    const attempts = await Promise.allSettled([
      repository.changeRole(context, {
        targetMembershipId: houses.first.nonOwner.membershipId,
        role: 'steward',
        auditId: '01941f29-7c00-7000-8000-000000000710',
        changedAt: at,
      }),
      repository.remove(context, {
        targetMembershipId: houses.first.nonOwner.membershipId,
        auditId: '01941f29-7c00-7000-8000-000000000711',
        removedAt: at,
      }),
      repository.leave(context, {
        auditId: '01941f29-7c00-7000-8000-000000000712',
        leftAt: at,
      }),
      repository.transferOwnership(context, {
        targetMembershipId: houses.first.nonOwner.membershipId,
        idempotencyKey: 'cross-house-transfer',
        auditId: '01941f29-7c00-7000-8000-000000000713',
        transferredAt: at,
      }),
    ]);

    for (const attempt of attempts) {
      expect(attempt).toMatchObject({
        status: 'rejected',
        reason: { code: expect.any(String) },
      });
    }
    await expect(
      repository.findOwnershipTransferReplay(context, {
        targetMembershipId: houses.first.nonOwner.membershipId,
        idempotencyKey: 'cross-house-transfer',
      }),
    ).resolves.toBeNull();
    const state = await database.query(
      `select h.owner_membership_id::text,
              (select count(*)::integer from membership_audit
                where id between $2::uuid and $3::uuid) as audit_count
         from houses h where h.id = $1`,
      [
        houses.first.houseId,
        '01941f29-7c00-7000-8000-000000000710',
        '01941f29-7c00-7000-8000-000000000713',
      ],
    );
    expect(state.rows).toEqual([
      { owner_membership_id: houses.first.member.membershipId, audit_count: 0 },
    ]);
  });

  it('[BM-015] [DR-HOUSE-02] serializes ownership transfer against Owner leave', async () => {
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    const settled = await Promise.allSettled([
      repository.transferOwnership(context, {
        targetMembershipId: houses.first.nonOwner.membershipId,
        idempotencyKey: 'concurrent-transfer',
        auditId: '01941f29-7c00-7000-8000-000000000714',
        transferredAt: new Date('2026-08-30T16:50:00.000Z'),
      }),
      repository.leave(context, {
        auditId: '01941f29-7c00-7000-8000-000000000715',
        leftAt: new Date('2026-08-30T16:50:00.000Z'),
      }),
    ]);

    expect(settled[0]?.status).toBe('fulfilled');
    const state = await database.query(
      `select h.owner_membership_id::text,
              old_owner.role as old_owner_role,
              old_owner.status as old_owner_status,
              new_owner.role as new_owner_role,
              new_owner.status as new_owner_status,
              (select count(*)::integer from memberships
                where house_id = h.id and role = 'owner' and status = 'active') as owner_count
         from houses h
         join memberships old_owner on old_owner.id = $2
         join memberships new_owner on new_owner.id = h.owner_membership_id
        where h.id = $1`,
      [houses.first.houseId, houses.first.member.membershipId],
    );
    expect(state.rows).toEqual([
      {
        owner_membership_id: houses.first.nonOwner.membershipId,
        old_owner_role: 'member',
        old_owner_status: settled[1]?.status === 'fulfilled' ? 'left' : 'active',
        new_owner_role: 'owner',
        new_owner_status: 'active',
        owner_count: 1,
      },
    ]);
  });
});
