import {
  DomainError,
  invitationCreationPolicy,
  type AuthorizationContext,
  type InvitationCreationInput,
  type InvitationCreationRepository,
  type InvitationInspectionInput,
  type InvitationInspectionRepository,
  type InvitationPreview,
  type InvitationRevocationInput,
  type InvitationRevocationRepository,
  type InvitationRevocationResult,
  type PersistedInvitationCreation,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface CreationContextRow extends QueryResultRow {
  readonly member_cap: unknown;
  readonly creator_membership_id: unknown;
}

interface RevocationRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly revoked_at: unknown;
}

interface InspectionRow extends QueryResultRow {
  readonly house_name: unknown;
}

interface ExistingInvitationRow extends QueryResultRow {
  readonly invitation_id: unknown;
  readonly house_id: unknown;
  readonly creator_membership_id: unknown;
  readonly intended_email: unknown;
  readonly expires_at: unknown;
  readonly use_limit: unknown;
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Invitation ${field}`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Invitation ${field}`);
  return value;
}

function parseDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Invitation ${field}`);
  }
  return value;
}

function requestedEmail(input: InvitationCreationInput): string | null {
  if (input.command.kind === 'shared') return null;
  const email = input.command.intendedEmail.trim().toLowerCase();
  if (email.length === 0) {
    throw new DomainError('validation_failed', 'Restricted Invitation email is required');
  }
  return email;
}

async function loadCreationContext(client: PoolClient, context: AuthorizationContext) {
  const result = await client.query<CreationContextRow>(
    `select h.member_cap, m.id::text as creator_membership_id
       from houses h
       join memberships m
         on m.house_id = h.id
        and m.user_id = $2
        and m.status = 'active'
        and m.role in ('owner', 'steward')
      where h.id = $1 and h.status = 'active'
      for update of h, m`,
    [context.houseId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'House membership is unavailable');
  return {
    memberCap: parseInteger(row.member_cap, 'member cap'),
    creatorMembershipId: parseString(row.creator_membership_id, 'creator membership id'),
  };
}

async function findIdempotentCreation(
  client: PoolClient,
  context: AuthorizationContext,
  creatorMembershipId: string,
  input: InvitationCreationInput,
): Promise<PersistedInvitationCreation | null> {
  const result = await client.query<ExistingInvitationRow>(
    `select id::text as invitation_id, house_id::text,
            creator_membership_id::text, intended_email,
            expires_at, use_limit
       from invitations
      where token_digest = decode($1, 'hex')
      limit 1`,
    [input.tokenDigestHex],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  const intendedEmail = row.intended_email;
  if (intendedEmail !== null && typeof intendedEmail !== 'string') {
    throw new Error('Invalid Invitation intended email');
  }
  if (
    parseString(row.house_id, 'House id') !== context.houseId ||
    parseString(row.creator_membership_id, 'creator membership id') !== creatorMembershipId ||
    intendedEmail !== requestedEmail(input)
  ) {
    throw new DomainError(
      'idempotency_conflict',
      'Idempotency key was reused for another Invitation',
    );
  }

  return {
    invitationId: parseString(row.invitation_id, 'id'),
    houseId: context.houseId,
    expiresAt: parseDate(row.expires_at, 'expiry'),
    useLimit: parseInteger(row.use_limit, 'use limit'),
  };
}

/** [BM-014] [DR-INVITE-01..06] PostgreSQL Invitation creation and audit adapter. */
export class PgInvitationRepository
  implements
    InvitationCreationRepository,
    InvitationRevocationRepository,
    InvitationInspectionRepository
{
  constructor(private readonly database: Pool) {}

  async create(
    context: AuthorizationContext,
    input: InvitationCreationInput,
  ): Promise<PersistedInvitationCreation> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const creationContext = await loadCreationContext(client, context);
      const replay = await findIdempotentCreation(
        client,
        context,
        creationContext.creatorMembershipId,
        input,
      );
      if (replay !== null) {
        await client.query('commit');
        return replay;
      }
      const activeMembers = await client.query<{ count: number }>(
        `select count(*)::integer as count
           from memberships
          where house_id = $1 and status = 'active'`,
        [context.houseId],
      );
      const activeMemberCount = parseInteger(activeMembers.rows[0]?.count, 'active member count');
      const policy = invitationCreationPolicy(input.command, {
        activeMemberCount,
        memberCap: creationContext.memberCap,
        createdAt: input.createdAt,
      });

      await client.query(
        `insert into invitations
          (id, house_id, token_digest, intended_email, role_grant, expires_at,
           use_limit, use_count, revoked_at, creator_membership_id, created_at)
         values ($1, $2, decode($3, 'hex'), $4, 'member', $5, $6, 0, null, $7, $8)`,
        [
          input.invitationId,
          context.houseId,
          input.tokenDigestHex,
          policy.intendedEmail,
          policy.expiresAt,
          policy.useLimit,
          creationContext.creatorMembershipId,
          input.createdAt,
        ],
      );
      await client.query(
        `insert into membership_audit
          (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
         values ($1, $2, $3, 'invite_created', null, $4, $5)`,
        [
          input.auditId,
          context.houseId,
          creationContext.creatorMembershipId,
          {
            invitation_id: input.invitationId,
            kind: policy.kind,
            use_limit: policy.useLimit,
          },
          input.createdAt,
        ],
      );
      await client.query('commit');
      return {
        invitationId: input.invitationId,
        houseId: context.houseId,
        expiresAt: policy.expiresAt,
        useLimit: policy.useLimit,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(
    context: AuthorizationContext,
    input: InvitationRevocationInput,
  ): Promise<InvitationRevocationResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const found = await client.query<RevocationRow>(
        `select i.revoked_at, m.id::text as actor_membership_id
           from invitations i
           join memberships m
             on m.house_id = i.house_id
            and m.user_id = $3
            and m.status = 'active'
            and m.role in ('owner', 'steward')
          where i.id = $1 and i.house_id = $2
          for update of i, m`,
        [input.invitationId, context.houseId, context.viewerId],
      );
      const row = found.rows[0];
      if (row === undefined) throw new DomainError('not_found', 'Invitation is unavailable');
      if (row.revoked_at !== null) {
        await client.query('commit');
        return { revokedNow: false };
      }

      const actorMembershipId = parseString(row.actor_membership_id, 'actor membership id');
      await client.query('update invitations set revoked_at = $2 where id = $1', [
        input.invitationId,
        input.revokedAt,
      ]);
      await client.query(
        `insert into membership_audit
          (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
         values ($1, $2, $3, 'invite_revoked', null, $4, $5)`,
        [
          input.auditId,
          context.houseId,
          actorMembershipId,
          { invitation_id: input.invitationId },
          input.revokedAt,
        ],
      );
      await client.query('commit');
      return { revokedNow: true };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async inspect(input: InvitationInspectionInput): Promise<InvitationPreview | null> {
    const result = await this.database.query<InspectionRow>(
      `select h.name as house_name
         from invitations i
         join houses h on h.id = i.house_id and h.status = 'active'
        where i.token_digest = decode($1, 'hex')
          and i.revoked_at is null
          and i.expires_at > $2
          and i.use_count < i.use_limit
        limit 1`,
      [input.tokenDigestHex, input.inspectedAt],
    );
    const row = result.rows[0];
    return row === undefined ? null : { houseName: parseString(row.house_name, 'House name') };
  }
}
