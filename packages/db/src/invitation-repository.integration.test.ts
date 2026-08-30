import type { InvitationCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgInvitationRepository } from './pg-invitation-repository';
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

integration('PostgreSQL Invitation repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const repository = new PgInvitationRepository(database);
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
});
