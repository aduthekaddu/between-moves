import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** [BM-007] [DR-ID-04] Durable identity mapped to Better Auth's user model. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().notNull(),
    displayName: text('display_name').notNull(),
    email: citext('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    imageUrl: text('image_url'),
    status: text('status').default('active').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_active_email_unique')
      .on(table.email)
      .where(sql`${table.status} <> 'deleted'`),
    check('users_display_name_check', sql`char_length(${table.displayName}) between 1 and 60`),
    check('users_status_check', sql`${table.status} in ('active', 'deleted')`),
    check(
      'users_deletion_state_check',
      sql`(${table.status} = 'active' and ${table.deletedAt} is null) or ${table.status} = 'deleted'`,
    ),
  ],
);

/** [BM-007] [DR-ID-02] Better Auth database-backed session storage. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    check('sessions_token_length_check', sql`char_length(${table.token}) >= 32`),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_active_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
  ],
);

/** [BM-008] [DR-ID-02] Better Auth-owned provider account linkage. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().notNull(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('accounts_issuer_account_unique').on(table.issuer, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

/** [BM-008] [DR-ID-03] Better Auth single-use verification values with short TTL. */
export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().notNull(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expiry_idx').on(table.expiresAt),
  ],
);

/** [BM-005] Scaffold-only table proving scoped repository reads against PostgreSQL. */
export const houseReferenceRecords = pgTable(
  'house_reference_records',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id').notNull(),
    authorizedViewerId: uuid('authorized_viewer_id').notNull(),
    membershipStatus: text('membership_status').notNull(),
    label: text('label').notNull(),
  },
  (table) => [
    index('house_reference_records_authorized_read_idx')
      .on(table.houseId, table.authorizedViewerId)
      .where(sql`${table.membershipStatus} = 'active'`),
  ],
);

/** [BM-006] DR-DELIV-01 transactional outbox schema. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().notNull(),
    topic: text('topic').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    houseId: uuid('house_id'),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('outbox_events_aggregate_sequence_unique').on(table.aggregateId, table.sequence),
    index('outbox_events_dispatch_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.sentAt} is null and ${table.failedAt} is null`),
    check('outbox_events_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'outbox_events_terminal_state_check',
      sql`${table.sentAt} is null or ${table.failedAt} is null`,
    ),
  ],
);

/** [BM-011] [DR-HOUSE-01..02] Private House aggregate root. */
export const houses = pgTable(
  'houses',
  {
    id: uuid('id').primaryKey().notNull(),
    name: text('name').notNull(),
    slug: citext('slug').notNull(),
    description: text('description'),
    emblemSeed: text('emblem_seed').notNull(),
    timeZone: text('time_zone').notNull(),
    ownerMembershipId: uuid('owner_membership_id'),
    memberCap: integer('member_cap').default(30).notNull(),
    status: text('status').default('active').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('houses_active_slug_unique')
      .on(table.slug)
      .where(sql`${table.status} <> 'deleted'`),
    check('houses_name_check', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'houses_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 500`,
    ),
    check('houses_member_cap_check', sql`${table.memberCap} between 3 and 30`),
    check('houses_status_check', sql`${table.status} in ('active', 'deleted')`),
  ],
);

/** [BM-011] [DR-MEM-01..02] One durable membership row per person and House. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').default('member').notNull(),
    status: text('status').default('active').notNull(),
    displayNameSnapshot: text('display_name_snapshot'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memberships_house_user_unique').on(table.houseId, table.userId),
    uniqueIndex('memberships_one_active_owner_per_house')
      .on(table.houseId)
      .where(sql`${table.role} = 'owner' and ${table.status} = 'active'`),
    index('memberships_house_status_idx').on(table.houseId, table.status),
    index('memberships_user_status_idx').on(table.userId, table.status),
    check('memberships_role_check', sql`${table.role} in ('owner', 'steward', 'member')`),
    check('memberships_status_check', sql`${table.status} in ('active', 'left', 'removed')`),
  ],
);

/** [BM-014] [DR-INVITE-01..06] Digest-only, capacity-bounded House Invitations. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    tokenDigest: customType<{ data: Buffer }>({ dataType: () => 'bytea' })(
      'token_digest',
    ).notNull(),
    intendedEmail: citext('intended_email'),
    roleGrant: text('role_grant').default('member').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    useLimit: integer('use_limit').notNull(),
    useCount: integer('use_count').default(0).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    creatorMembershipId: uuid('creator_membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('invitations_token_digest_unique').on(table.tokenDigest),
    index('invitations_house_expiry_idx').on(table.houseId, table.expiresAt),
    check('invitations_token_digest_length_check', sql`octet_length(${table.tokenDigest}) = 32`),
    check('invitations_role_grant_check', sql`${table.roleGrant} = 'member'`),
    check('invitations_use_limit_check', sql`${table.useLimit} > 0`),
    check(
      'invitations_use_count_check',
      sql`${table.useCount} >= 0 and ${table.useCount} <= ${table.useLimit}`,
    ),
    check(
      'invitations_restriction_check',
      sql`(${table.intendedEmail} is null and ${table.useLimit} >= 1) or (${table.intendedEmail} is not null and ${table.useLimit} = 1)`,
    ),
    check('invitations_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/** [BM-011] [DR-SEC-06] Append-only privileged membership history. */
export const membershipAudit = pgTable(
  'membership_audit',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').references(() => memberships.id, {
      onDelete: 'restrict',
    }),
    action: text('action').notNull(),
    targetMembershipId: uuid('target_membership_id').references(() => memberships.id, {
      onDelete: 'restrict',
    }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('membership_audit_house_created_idx').on(table.houseId, table.createdAt)],
);
