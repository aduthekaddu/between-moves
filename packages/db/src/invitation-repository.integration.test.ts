import type { InvitationCreationInput, InvitationRedemptionInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgInvitationRepository } from './pg-invitation-repository';
import { PgInvitationRedemptionRepository } from './pg-invitation-redemption-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function creationInput(): InvitationCreationInput {
  return {
    invitationId: '01941f29-7c00-7000-8000-000000000701',
    auditId: '01941f29-7c00-7000-8000-000000000702',
    command: { kind: 'shared' },
    tokenDigestHex: 'a'.repeat(64),
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
  };
}

function redemptionInput(
  overrides: Partial<InvitationRedemptionInput> = {},
): InvitationRedemptionInput {
  return {
    tokenDigestHex: '2'.repeat(64),
    userId: '01941f29-7c00-7000-8000-000000000751',
    membershipId: '01941f29-7c00-7000-8000-000000000752',
    auditId: '01941f29-7c00-7000-8000-000000000753',
    redeemedAt: new Date('2026-08-31T10:00:00.000Z'),
    ...overrides,
  };
}

integration('PostgreSQL Invitation repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const repository = new PgInvitationRepository(database);
  const redemptions = new PgInvitationRedemptionRepository(database);
  let houses: TwoHousesWithMembers;

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    houses = await twoHousesWithMembers(database);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-014] [DR-INVITE-01..04] stores only the digest, capacity limit, and creation audit', async () => {
    const input = creationInput();
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });

    await expect(repository.create(context, input)).resolves.toEqual({
      invitationId: input.invitationId,
      houseId: houses.first.houseId,
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 28,
    });
    await expect(
      repository.create(context, {
        ...input,
        invitationId: '01941f29-7c00-7000-8000-000000000703',
        auditId: '01941f29-7c00-7000-8000-000000000704',
      }),
    ).resolves.toEqual({
      invitationId: input.invitationId,
      houseId: houses.first.houseId,
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 28,
    });

    const rows = await database.query(
      `select encode(i.token_digest, 'hex') as token_digest_hex, i.role_grant,
              i.use_limit, i.use_count, i.intended_email,
              i.creator_membership_id::text, a.action, a.actor_membership_id::text, a.metadata
         from invitations i
         join membership_audit a on a.id = $2
        where i.id = $1`,
      [input.invitationId, input.auditId],
    );
    expect(rows.rows).toEqual([
      {
        token_digest_hex: input.tokenDigestHex,
        role_grant: 'member',
        use_limit: 28,
        use_count: 0,
        intended_email: null,
        creator_membership_id: houses.first.member.membershipId,
        action: 'invite_created',
        actor_membership_id: houses.first.member.membershipId,
        metadata: { invitation_id: input.invitationId, kind: 'shared', use_limit: 28 },
      },
    ]);
    const replayCounts = await database.query(
      `select
         (select count(*)::integer from invitations where token_digest = decode($1, 'hex')) as invitations,
         (select count(*)::integer from membership_audit where id in ($2, $3)) as audits`,
      [input.tokenDigestHex, input.auditId, '01941f29-7c00-7000-8000-000000000704'],
    );
    expect(replayCounts.rows).toEqual([{ invitations: 1, audits: 1 }]);
  });

  it('[BM-014] keeps concurrent transport retries single-effect under the House lock', async () => {
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    const first = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000709',
      auditId: '01941f29-7c00-7000-8000-000000000710',
      tokenDigestHex: '1'.repeat(64),
    };
    const second = {
      ...first,
      invitationId: '01941f29-7c00-7000-8000-000000000715',
      auditId: '01941f29-7c00-7000-8000-000000000716',
    };

    const results = await Promise.all([
      repository.create(context, first),
      repository.create(context, second),
    ]);
    expect(results[0]?.invitationId).toBe(results[1]?.invitationId);
    expect([first.invitationId, second.invitationId]).toContain(results[0]?.invitationId);

    const counts = await database.query(
      `select
         (select count(*)::integer from invitations where token_digest = decode($1, 'hex')) as invitations,
         (select count(*)::integer from membership_audit
           where action = 'invite_created'
             and metadata->>'invitation_id' = $2) as audits`,
      [first.tokenDigestHex, results[0]?.invitationId],
    );
    expect(counts.rows).toEqual([{ invitations: 1, audits: 1 }]);
  });

  it('[BM-014] [DR-INVITE-06] denies member-role and cross-House creation contexts', async () => {
    const attempts = [
      fakeAuthorizationContext({
        viewerId: houses.first.nonOwner.userId,
        houseId: houses.first.houseId,
      }),
      fakeAuthorizationContext({
        viewerId: houses.second.member.userId,
        houseId: houses.first.houseId,
      }),
    ];

    for (const [index, context] of attempts.entries()) {
      await expect(
        repository.create(context, {
          ...creationInput(),
          invitationId: `01941f29-7c00-7000-8000-00000000073${index}`,
          auditId: `01941f29-7c00-7000-8000-00000000074${index}`,
          tokenDigestHex: String(index + 4).repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('[BM-014] [DR-INVITE-06] cannot revoke an Invitation through another House context', async () => {
    const input = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000711',
      auditId: '01941f29-7c00-7000-8000-000000000712',
      tokenDigestHex: 'b'.repeat(64),
    };
    await repository.create(
      fakeAuthorizationContext({
        viewerId: houses.first.member.userId,
        houseId: houses.first.houseId,
      }),
      input,
    );

    const attempts = [
      fakeAuthorizationContext({
        viewerId: houses.first.nonOwner.userId,
        houseId: houses.first.houseId,
      }),
      fakeAuthorizationContext({
        viewerId: houses.second.member.userId,
        houseId: houses.second.houseId,
      }),
    ];
    for (const context of attempts) {
      await expect(
        repository.revoke(context, {
          invitationId: input.invitationId,
          auditId: '01941f29-7c00-7000-8000-000000000713',
          revokedAt: new Date('2026-08-30T11:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
    const row = await database.query('select revoked_at from invitations where id = $1', [
      input.invitationId,
    ]);
    expect(row.rows).toEqual([{ revoked_at: null }]);
  });

  it('[BM-014] [DR-INVITE-05] persists a normalized single-use email restriction and rejects key reuse for another command', async () => {
    const input: InvitationCreationInput = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000705',
      auditId: '01941f29-7c00-7000-8000-000000000706',
      command: { kind: 'single', intendedEmail: ' Friend@Example.Test ' },
      tokenDigestHex: 'd'.repeat(64),
    };
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });

    await expect(repository.create(context, input)).resolves.toMatchObject({ useLimit: 1 });
    const row = await database.query(
      `select intended_email::text, role_grant, use_limit
         from invitations
        where id = $1`,
      [input.invitationId],
    );
    expect(row.rows).toEqual([
      { intended_email: 'friend@example.test', role_grant: 'member', use_limit: 1 },
    ]);

    await expect(
      repository.create(context, {
        ...input,
        invitationId: '01941f29-7c00-7000-8000-000000000707',
        auditId: '01941f29-7c00-7000-8000-000000000708',
        command: { kind: 'shared' },
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('[BM-014] treats expired and exhausted Invitations as the same unusable inspection state', async () => {
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    const expired = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000725',
      auditId: '01941f29-7c00-7000-8000-000000000726',
      tokenDigestHex: 'e'.repeat(64),
    };
    const exhausted = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000727',
      auditId: '01941f29-7c00-7000-8000-000000000728',
      tokenDigestHex: 'f'.repeat(64),
    };
    await repository.create(context, expired);
    await repository.create(context, exhausted);
    await database.query('update invitations set use_count = use_limit where id = $1', [
      exhausted.invitationId,
    ]);

    await expect(
      repository.inspect({
        tokenDigestHex: expired.tokenDigestHex,
        inspectedAt: new Date('2026-09-06T10:00:01.000Z'),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.inspect({
        tokenDigestHex: exhausted.tokenDigestHex,
        inspectedAt: new Date('2026-08-30T11:00:00.000Z'),
      }),
    ).resolves.toBeNull();
  });

  it('[BM-014] revokes idempotently, audits once, and makes inspection unusable', async () => {
    const input = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000721',
      auditId: '01941f29-7c00-7000-8000-000000000722',
      tokenDigestHex: 'c'.repeat(64),
    };
    const context = fakeAuthorizationContext({
      viewerId: houses.first.member.userId,
      houseId: houses.first.houseId,
    });
    await repository.create(context, input);
    await expect(
      repository.inspect({
        tokenDigestHex: input.tokenDigestHex,
        inspectedAt: new Date('2026-08-30T11:00:00.000Z'),
      }),
    ).resolves.toEqual({ houseName: houses.first.name });

    await expect(
      repository.revoke(context, {
        invitationId: input.invitationId,
        auditId: '01941f29-7c00-7000-8000-000000000723',
        revokedAt: new Date('2026-08-30T12:00:00.000Z'),
      }),
    ).resolves.toEqual({ revokedNow: true });
    await expect(
      repository.revoke(context, {
        invitationId: input.invitationId,
        auditId: '01941f29-7c00-7000-8000-000000000724',
        revokedAt: new Date('2026-08-30T12:01:00.000Z'),
      }),
    ).resolves.toEqual({ revokedNow: false });
    await expect(
      repository.inspect({
        tokenDigestHex: input.tokenDigestHex,
        inspectedAt: new Date('2026-08-30T12:01:00.000Z'),
      }),
    ).resolves.toBeNull();

    const audits = await database.query(
      `select id::text, action, metadata
         from membership_audit
        where house_id = $1 and action = 'invite_revoked' and metadata->>'invitation_id' = $2`,
      [houses.first.houseId, input.invitationId],
    );
    expect(audits.rows).toEqual([
      {
        id: '01941f29-7c00-7000-8000-000000000723',
        action: 'invite_revoked',
        metadata: { invitation_id: input.invitationId },
      },
    ]);
  });

  it('[BM-016] [DR-INVITE-07/08] admits a signed-in person and audits redemption atomically', async () => {
    const invitation = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000749',
      auditId: '01941f29-7c00-7000-8000-000000000750',
      tokenDigestHex: '2'.repeat(64),
    };
    await repository.create(
      fakeAuthorizationContext({
        viewerId: houses.first.member.userId,
        houseId: houses.first.houseId,
      }),
      invitation,
    );
    const input = redemptionInput();
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'New Friend', 'new-friend@example.test', true)`,
      [input.userId],
    );

    await expect(redemptions.redeem(input)).resolves.toEqual({
      houseId: houses.first.houseId,
      membershipId: input.membershipId,
      inviteKind: 'shared',
      reactivated: false,
    });

    const rows = await database.query(
      `select m.house_id::text, m.user_id::text, m.role, m.status,
              i.use_count, a.action, a.actor_membership_id::text,
              a.target_membership_id::text, a.metadata
         from memberships m
         join invitations i on i.id = $2
         join membership_audit a on a.id = $3
        where m.id = $1`,
      [input.membershipId, invitation.invitationId, input.auditId],
    );
    expect(rows.rows).toEqual([
      {
        house_id: houses.first.houseId,
        user_id: input.userId,
        role: 'member',
        status: 'active',
        use_count: 1,
        action: 'member_joined',
        actor_membership_id: input.membershipId,
        target_membership_id: input.membershipId,
        metadata: { invitation_id: invitation.invitationId, reactivated: false },
      },
    ]);
  });

  it('[BM-016] [DR-INVITE-10] returns the original redemption without another use or audit', async () => {
    const invitation = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000754',
      auditId: '01941f29-7c00-7000-8000-000000000755',
      tokenDigestHex: '3'.repeat(64),
    };
    await repository.create(
      fakeAuthorizationContext({
        viewerId: houses.first.member.userId,
        houseId: houses.first.houseId,
      }),
      invitation,
    );
    const input = redemptionInput({
      tokenDigestHex: invitation.tokenDigestHex,
      userId: '01941f29-7c00-7000-8000-000000000756',
      membershipId: '01941f29-7c00-7000-8000-000000000757',
      auditId: '01941f29-7c00-7000-8000-000000000758',
    });
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Repeat Friend', 'repeat-friend@example.test', true)`,
      [input.userId],
    );

    const first = await redemptions.redeem(input);
    const replay = await redemptions.redeem({
      ...input,
      membershipId: '01941f29-7c00-7000-8000-000000000759',
      auditId: '01941f29-7c00-7000-8000-000000000760',
      redeemedAt: new Date('2026-09-07T10:00:00.000Z'),
    });

    expect(replay).toEqual(first);
    const counts = await database.query(
      `select i.use_count,
              (select count(*)::integer from memberships
                where house_id = i.house_id and user_id = $2) as memberships,
              (select count(*)::integer from membership_audit
                where target_membership_id = $3
                  and metadata->>'invitation_id' = $4) as audits
         from invitations i
        where i.id = $1`,
      [invitation.invitationId, input.userId, input.membershipId, invitation.invitationId],
    );
    expect(counts.rows).toEqual([{ use_count: 1, memberships: 1, audits: 1 }]);
  });

  it('[BM-016] [DR-MEM-07] reactivates the existing membership row as a Member', async () => {
    const invitation = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000761',
      auditId: '01941f29-7c00-7000-8000-000000000762',
      tokenDigestHex: '4'.repeat(64),
    };
    await repository.create(
      fakeAuthorizationContext({
        viewerId: houses.first.member.userId,
        houseId: houses.first.houseId,
      }),
      invitation,
    );
    const input = redemptionInput({
      tokenDigestHex: invitation.tokenDigestHex,
      userId: '01941f29-7c00-7000-8000-000000000763',
      membershipId: '01941f29-7c00-7000-8000-000000000764',
      auditId: '01941f29-7c00-7000-8000-000000000765',
    });
    const existingMembershipId = '01941f29-7c00-7000-8000-000000000766';
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Returning Friend', 'returning-friend@example.test', true)`,
      [input.userId],
    );
    await database.query(
      `insert into memberships
        (id, house_id, user_id, role, status, joined_at, left_at, created_at, updated_at)
       values ($1, $2, $3, 'steward', 'left', $4, $5, $4, $5)`,
      [
        existingMembershipId,
        houses.first.houseId,
        input.userId,
        new Date('2026-08-01T10:00:00.000Z'),
        new Date('2026-08-20T10:00:00.000Z'),
      ],
    );

    await expect(redemptions.redeem(input)).resolves.toEqual({
      houseId: houses.first.houseId,
      membershipId: existingMembershipId,
      inviteKind: 'shared',
      reactivated: true,
    });
    const rows = await database.query(
      `select role, status, left_at, a.metadata
         from memberships m
         join membership_audit a on a.id = $2
        where m.id = $1`,
      [existingMembershipId, input.auditId],
    );
    expect(rows.rows).toEqual([
      {
        role: 'member',
        status: 'active',
        left_at: null,
        metadata: { invitation_id: invitation.invitationId, reactivated: true },
      },
    ]);
  });

  it('[BM-016] rejects revoked, expired, and email-mismatched Invitations without side effects', async () => {
    const userId = '01941f29-7c00-7000-8000-000000000767';
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Wrong Friend', 'wrong-friend@example.test', true)`,
      [userId],
    );
    const attempts = [
      {
        invitationId: '01941f29-7c00-7000-8000-000000000768',
        auditId: '01941f29-7c00-7000-8000-000000000769',
        tokenDigestHex: '5'.repeat(64),
        command: { kind: 'shared' as const },
        mutation: "update invitations set revoked_at = '2026-08-31T09:00:00.000Z' where id = $1",
        redeemedAt: new Date('2026-08-31T10:00:00.000Z'),
      },
      {
        invitationId: '01941f29-7c00-7000-8000-000000000770',
        auditId: '01941f29-7c00-7000-8000-000000000771',
        tokenDigestHex: '6'.repeat(64),
        command: { kind: 'shared' as const },
        mutation: null,
        redeemedAt: new Date('2026-09-07T10:00:00.000Z'),
      },
      {
        invitationId: '01941f29-7c00-7000-8000-000000000772',
        auditId: '01941f29-7c00-7000-8000-000000000773',
        tokenDigestHex: '7'.repeat(64),
        command: { kind: 'single' as const, intendedEmail: 'another-friend@example.test' },
        mutation: null,
        redeemedAt: new Date('2026-08-31T10:00:00.000Z'),
      },
    ];

    for (const [index, attempt] of attempts.entries()) {
      await repository.create(
        fakeAuthorizationContext({
          viewerId: houses.first.member.userId,
          houseId: houses.first.houseId,
        }),
        {
          ...creationInput(),
          invitationId: attempt.invitationId,
          auditId: attempt.auditId,
          tokenDigestHex: attempt.tokenDigestHex,
          command: attempt.command,
        },
      );
      if (attempt.mutation !== null) {
        await database.query(attempt.mutation, [attempt.invitationId]);
      }
      await expect(
        redemptions.redeem(
          redemptionInput({
            tokenDigestHex: attempt.tokenDigestHex,
            userId,
            membershipId: `01941f29-7c00-7000-8000-00000000078${index}`,
            auditId: `01941f29-7c00-7000-8000-00000000079${index}`,
            redeemedAt: attempt.redeemedAt,
          }),
        ),
      ).rejects.toMatchObject({ failure: 'invalid' });
    }

    const effects = await database.query(
      `select
         (select count(*)::integer from memberships where user_id = $1) as memberships,
         (select sum(use_count)::integer from invitations where id = any($2::uuid[])) as uses`,
      [userId, attempts.map(({ invitationId }) => invitationId)],
    );
    expect(effects.rows).toEqual([{ memberships: 0, uses: 0 }]);
  });

  it('[BM-016] [DR-SEC-02] serializes concurrent redemptions at the Invitation use limit', async () => {
    const invitation = {
      ...creationInput(),
      invitationId: '01941f29-7c00-7000-8000-000000000801',
      auditId: '01941f29-7c00-7000-8000-000000000802',
      tokenDigestHex: '8'.repeat(64),
    };
    await repository.create(
      fakeAuthorizationContext({
        viewerId: houses.first.member.userId,
        houseId: houses.first.houseId,
      }),
      invitation,
    );
    await database.query('update invitations set use_limit = 1 where id = $1', [
      invitation.invitationId,
    ]);
    const userIds = [
      '01941f29-7c00-7000-8000-000000000803',
      '01941f29-7c00-7000-8000-000000000804',
    ];
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'First Racer', 'first-racer@example.test', true),
              ($2, 'Second Racer', 'second-racer@example.test', true)`,
      userIds,
    );

    const results = await Promise.allSettled(
      userIds.map((userId, index) =>
        redemptions.redeem(
          redemptionInput({
            tokenDigestHex: invitation.tokenDigestHex,
            userId,
            membershipId: `01941f29-7c00-7000-8000-00000000081${index}`,
            auditId: `01941f29-7c00-7000-8000-00000000082${index}`,
          }),
        ),
      ),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const counts = await database.query(
      `select i.use_count,
              (select count(*)::integer from memberships
                where user_id = any($2::uuid[]) and status = 'active') as admitted
         from invitations i where i.id = $1`,
      [invitation.invitationId, userIds],
    );
    expect(counts.rows).toEqual([{ use_count: 1, admitted: 1 }]);
  });

  it('[BM-016] [DR-INVITE-11] serializes different Invitations against House capacity', async () => {
    const current = await database.query<{ count: number }>(
      `select count(*)::integer as count
         from memberships
        where house_id = $1 and status = 'active'`,
      [houses.second.houseId],
    );
    const memberCap = (current.rows[0]?.count ?? 0) + 1;
    await database.query('update houses set member_cap = $2 where id = $1', [
      houses.second.houseId,
      memberCap,
    ]);
    const context = fakeAuthorizationContext({
      viewerId: houses.second.member.userId,
      houseId: houses.second.houseId,
    });
    const invitations = [
      {
        ...creationInput(),
        invitationId: '01941f29-7c00-7000-8000-000000000831',
        auditId: '01941f29-7c00-7000-8000-000000000832',
        tokenDigestHex: '9'.repeat(64),
      },
      {
        ...creationInput(),
        invitationId: '01941f29-7c00-7000-8000-000000000833',
        auditId: '01941f29-7c00-7000-8000-000000000834',
        tokenDigestHex: 'a1'.repeat(32),
      },
    ];
    for (const invitation of invitations) await repository.create(context, invitation);
    const userIds = [
      '01941f29-7c00-7000-8000-000000000835',
      '01941f29-7c00-7000-8000-000000000836',
    ];
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Capacity Racer One', 'capacity-one@example.test', true),
              ($2, 'Capacity Racer Two', 'capacity-two@example.test', true)`,
      userIds,
    );

    try {
      const results = await Promise.allSettled(
        invitations.map((invitation, index) => {
          const userId = userIds[index];
          if (userId === undefined) throw new Error('Capacity fixture user is missing');
          return redemptions.redeem(
            redemptionInput({
              tokenDigestHex: invitation.tokenDigestHex,
              userId,
              membershipId: `01941f29-7c00-7000-8000-00000000084${index}`,
              auditId: `01941f29-7c00-7000-8000-00000000085${index}`,
            }),
          );
        }),
      );
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { failure: 'house_full' },
      });
      const active = await database.query<{ count: number }>(
        `select count(*)::integer as count
           from memberships
          where house_id = $1 and status = 'active'`,
        [houses.second.houseId],
      );
      expect(active.rows[0]?.count).toBe(memberCap);
    } finally {
      await database.query('update houses set member_cap = 30 where id = $1', [
        houses.second.houseId,
      ]);
    }
  });
});
