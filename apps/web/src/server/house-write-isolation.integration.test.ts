import {
  changeMembershipRole,
  createAuthorizeHouseAction,
  createInvitation,
  leaveHouse,
  redeemInvitation,
  removeHouseMember,
  revokeInvitation,
  transferHouseOwnership,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgHouseAuthorizationMembershipRepository,
  PgInvitationRedemptionRepository,
  PgInvitationRepository,
  PgMembershipAdminRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type {
  AuthenticatedViewer,
  AuthorizeHouseAction,
  Clock,
  IdGenerator,
  InvitationCreationRepository,
  InvitationRedemptionRepository,
  InvitationRevocationRepository,
  InvitationTokenDigester,
  InvitationTokenIssuer,
  MembershipAdminRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const invitationId = '01941f29-7c00-7000-8000-000000000901';
const invitationDigest = 'c'.repeat(64);
const invitationToken = 'bm-017-first-house-invitation-token';

interface IsolationHarness {
  readonly world: TwoHousesWithMembers;
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: InvitationTokenIssuer & InvitationTokenDigester;
  readonly invitations: InvitationCreationRepository & InvitationRevocationRepository;
  readonly redemptions: InvitationRedemptionRepository;
  readonly memberships: MembershipAdminRepository;
}

interface IsolationCase {
  readonly id: string;
  readonly name: string;
  readonly outcome: 'denied' | 'invitation-target-scoped';
  readonly expectedError?: Readonly<Record<string, unknown>>;
  readonly run: (harness: IsolationHarness) => Promise<unknown>;
}

const cases: readonly IsolationCase[] = [
  {
    id: 'invitation.create',
    name: 'Invitation creation',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      createInvitation(
        {
          houseId: harness.world.second.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: viewer(harness.world.first.member),
        },
        harness,
      ),
  },
  {
    id: 'invitation.revoke',
    name: 'Invitation revocation',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      revokeInvitation(
        {
          houseId: harness.world.second.houseId,
          invitationId,
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'invitation.redeem',
    name: 'Invitation redemption',
    outcome: 'invitation-target-scoped',
    run: (harness) =>
      redeemInvitation(
        { token: invitationToken, viewer: viewer(harness.world.second.member) },
        {
          clock: harness.clock,
          ids: harness.ids,
          tokens: harness.tokens,
          invitations: harness.redemptions,
        },
      ),
  },
  {
    id: 'membership.change-role',
    name: 'membership role change',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      changeMembershipRole(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          role: 'steward',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'membership.remove',
    name: 'Member removal',
    outcome: 'denied',
    expectedError: { code: 'not_found' },
    run: (harness) =>
      removeHouseMember(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
  {
    id: 'membership.leave',
    name: 'House leave',
    outcome: 'denied',
    expectedError: {
      code: 'authorization_denied',
      reason: 'not_a_member',
      crossHouse: true,
    },
    run: (harness) =>
      leaveHouse(
        {
          houseId: harness.world.second.houseId,
          viewer: viewer(harness.world.first.nonOwner),
        },
        harness,
      ),
  },
  {
    id: 'ownership.transfer',
    name: 'ownership transfer',
    outcome: 'denied',
    expectedError: { code: 'validation_failed' },
    run: (harness) =>
      transferHouseOwnership(
        {
          houseId: harness.world.second.houseId,
          targetMembershipId: harness.world.first.nonOwner.membershipId,
          idempotencyKey: 'bm-017-cross-house-transfer',
          viewer: viewer(harness.world.second.member),
        },
        harness,
      ),
  },
];

function viewer(member: {
  readonly userId: string;
  readonly displayName: string;
}): AuthenticatedViewer {
  return {
    kind: 'authenticated',
    userId: member.userId,
    displayName: member.displayName,
    imageUrl: null,
  };
}

function sequentialIds(): IdGenerator {
  let next = 920;
  return {
    generate: () => `01941f29-7c00-7000-8000-${String(next++).padStart(12, '0')}`,
  };
}

async function houseState(database: Pool, houseId: string): Promise<unknown> {
  const result = await database.query(
    `select jsonb_build_object(
       'owner', h.owner_membership_id::text,
       'memberships', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', m.id::text, 'user', m.user_id::text, 'role', m.role, 'status', m.status
         ) order by m.id)
         from memberships m where m.house_id = h.id
       ), '[]'::jsonb),
       'invitations', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', i.id::text, 'uses', i.use_count, 'revoked', i.revoked_at
         ) order by i.id)
         from invitations i where i.house_id = h.id
       ), '[]'::jsonb),
       'audits', coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', a.id::text, 'action', a.action, 'target', a.target_membership_id::text
         ) order by a.id)
         from membership_audit a where a.house_id = h.id
       ), '[]'::jsonb)
     ) as state
     from houses h where h.id = $1`,
    [houseId],
  );
  return result.rows[0]?.state;
}

integration('BM-017 current House write-path isolation', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  let harness: IsolationHarness;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    const world = await twoHousesWithMembers(database);
    const invitations = new PgInvitationRepository(database);
    const clock = { now: () => new Date('2026-09-01T10:00:00.000Z') };
    const ids = sequentialIds();
    const tokens = {
      issue: () => ({ raw: invitationToken, digestHex: invitationDigest }),
      digest: (rawToken: string) => (rawToken === invitationToken ? invitationDigest : null),
    };
    const authorizeHouseAction = createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: { record: () => undefined },
    });
    await invitations.create(
      fakeAuthorizationContext({
        viewerId: world.first.member.userId,
        houseId: world.first.houseId,
      }),
      {
        invitationId,
        auditId: '01941f29-7c00-7000-8000-000000000902',
        command: { kind: 'shared' },
        tokenDigestHex: invitationDigest,
        createdAt: clock.now(),
      },
    );
    harness = {
      world,
      authorizeHouseAction,
      clock,
      ids,
      tokens,
      invitations,
      redemptions: new PgInvitationRedemptionRepository(database),
      memberships: new PgMembershipAdminRepository(database),
    };
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it.each(cases)('[BM-017] [DR-MEM-04] denies or scopes $name ($id)', async (testCase) => {
    const firstBefore = await houseState(database, harness.world.first.houseId);
    const secondBefore = await houseState(database, harness.world.second.houseId);

    if (testCase.outcome === 'denied') {
      await expect(testCase.run(harness)).rejects.toMatchObject(testCase.expectedError ?? {});
      await expect(houseState(database, harness.world.first.houseId)).resolves.toEqual(firstBefore);
      await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(
        secondBefore,
      );
      return;
    }

    await expect(testCase.run(harness)).resolves.toMatchObject({
      houseId: harness.world.first.houseId,
    });
    await expect(houseState(database, harness.world.first.houseId)).resolves.not.toEqual(
      firstBefore,
    );
    await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(secondBefore);
  });

  it('[BM-017] switches one session between independent House capability contexts', async () => {
    const switchingViewer = viewer(harness.world.switchingMember);
    const firstBefore = await houseState(database, harness.world.first.houseId);
    const secondBefore = await houseState(database, harness.world.second.houseId);
    const scopedTokens = {
      issue: () => ({
        raw: 'bm-017-switching-member-first-house-token',
        digestHex: 'd'.repeat(64),
      }),
    };

    await expect(
      createInvitation(
        {
          houseId: harness.world.first.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: switchingViewer,
        },
        { ...harness, tokens: scopedTokens },
      ),
    ).resolves.toMatchObject({ houseId: harness.world.first.houseId });
    await expect(houseState(database, harness.world.first.houseId)).resolves.not.toEqual(
      firstBefore,
    );

    await expect(
      createInvitation(
        {
          houseId: harness.world.second.houseId,
          command: { kind: 'shared' },
          idempotencyKey: null,
          viewer: switchingViewer,
        },
        { ...harness, tokens: scopedTokens },
      ),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
      reason: 'role_not_permitted',
      crossHouse: false,
    });
    await expect(houseState(database, harness.world.second.houseId)).resolves.toEqual(secondBefore);
  });
});
