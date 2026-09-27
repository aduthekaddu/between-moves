import type { ClockPolicy } from '@between-moves/domain';
import { desc, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    lastError: text('last_error'),
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
    check(
      'outbox_events_last_error_length_check',
      sql`${table.lastError} is null or char_length(${table.lastError}) between 1 and 2000`,
    ),
  ],
);

/** [BM-030] Metadata-only, provider-ID-deduplicated Resend delivery events. */
export const emailDeliveryEvents = pgTable(
  'email_delivery_events',
  {
    id: text('id').primaryKey().notNull(),
    eventType: text('event_type').notNull(),
    emailId: text('email_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('email_delivery_events_email_occurred_idx').on(table.emailId, table.occurredAt),
    check('email_delivery_events_id_length_check', sql`char_length(${table.id}) between 1 and 256`),
    check(
      'email_delivery_events_type_check',
      sql`${table.eventType} in ('email.bounced', 'email.clicked', 'email.complained', 'email.delivered', 'email.delivery_delayed', 'email.failed', 'email.opened', 'email.scheduled', 'email.sent', 'email.suppressed')`,
    ),
    check(
      'email_delivery_events_email_id_length_check',
      sql`char_length(${table.emailId}) between 1 and 256`,
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
    unique('memberships_id_house_unique').on(table.id, table.houseId),
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

/** [BM-018] [DR-SEASON-01/03/04] House-scoped four-week Season lifecycle. */
export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    draftIdempotencyDigest: text('draft_idempotency_digest'),
    draftIdempotencyPayloadDigest: text('draft_idempotency_payload_digest'),
    state: text('state').default('draft').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    publishedCharterVersion: integer('published_charter_version'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    outboxSequence: bigint('outbox_sequence', { mode: 'bigint' }).default(0n).notNull(),
    gameCompletionSequence: bigint('game_completion_sequence', { mode: 'bigint' })
      .default(0n)
      .notNull(),
  },
  (table) => [
    unique('seasons_id_house_unique').on(table.id, table.houseId),
    uniqueIndex('seasons_one_active_or_closing_per_house')
      .on(table.houseId)
      .where(sql`${table.state} in ('active', 'closing')`),
    index('seasons_house_state_idx').on(table.houseId, table.state),
    uniqueIndex('seasons_house_draft_idempotency_unique')
      .on(table.houseId, table.draftIdempotencyDigest)
      .where(sql`${table.draftIdempotencyDigest} is not null`),
    check('seasons_title_check', sql`char_length(${table.title}) between 1 and 80`),
    check('seasons_state_check', sql`${table.state} in ('draft', 'active', 'closing', 'closed')`),
    check('seasons_outbox_sequence_check', sql`${table.outboxSequence} >= 0`),
    check('seasons_game_completion_sequence_check', sql`${table.gameCompletionSequence} >= 0`),
    check(
      'seasons_draft_idempotency_digest_check',
      sql`${table.draftIdempotencyDigest} is null or ${table.draftIdempotencyDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'seasons_draft_idempotency_payload_digest_check',
      sql`${table.draftIdempotencyPayloadDigest} is null or ${table.draftIdempotencyPayloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'seasons_draft_idempotency_pair_check',
      sql`(${table.draftIdempotencyDigest} is null) = (${table.draftIdempotencyPayloadDigest} is null)`,
    ),
    check(
      'seasons_lifecycle_fields_check',
      sql`(${table.state} = 'draft' and ${table.startsAt} is null and ${table.endsAt} is null and ${table.publishedCharterVersion} is null and ${table.closedAt} is null)
          or (${table.state} in ('active', 'closing') and ${table.startsAt} is not null and ${table.endsAt} > ${table.startsAt} and ${table.publishedCharterVersion} > 0 and ${table.closedAt} is null)
          or (${table.state} = 'closed' and ${table.startsAt} is not null and ${table.endsAt} > ${table.startsAt} and ${table.publishedCharterVersion} > 0 and ${table.closedAt} is not null)`,
    ),
  ],
);

/** [BM-018] [DR-SEASON-02/05] Immutable, monotonic Charter versions. */
export const seasonCharters = pgTable(
  'season_charters',
  {
    id: uuid('id').primaryKey().notNull(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    correspondencePaceHours: integer('correspondence_pace_hours').notNull(),
    nightRecurrence: jsonb('night_recurrence').notNull(),
    pointsRecipe: jsonb('points_recipe').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('season_charters_season_version_unique').on(table.seasonId, table.version),
    check('season_charters_version_check', sql`${table.version} > 0`),
    check('season_charters_pace_check', sql`${table.correspondencePaceHours} > 0`),
    check(
      'season_charters_night_recurrence_check',
      sql`jsonb_typeof(${table.nightRecurrence}) = 'object'`,
    ),
    check(
      'season_charters_points_recipe_check',
      sql`jsonb_typeof(${table.pointsRecipe}) = 'object'`,
    ),
  ],
);

/** [BM-020] [DR-NIGHT-01/03] Materialized weekly Between Moves Night schedule. */
export const houseNights = pgTable(
  'house_nights',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id').notNull(),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
    state: text('state').default('scheduled').notNull(),
    hostMembershipId: uuid('host_membership_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    chatSequence: bigint('chat_sequence', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('house_nights_id_house_unique').on(table.id, table.houseId),
    uniqueIndex('house_nights_season_start_unique').on(table.seasonId, table.scheduledStart),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'house_nights_season_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.hostMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'house_nights_host_house_fk',
    }).onDelete('restrict'),
    index('house_nights_house_schedule_idx').on(table.houseId, table.scheduledStart),
    index('house_nights_season_state_idx').on(table.seasonId, table.state),
    check('house_nights_interval_check', sql`${table.scheduledEnd} > ${table.scheduledStart}`),
    check(
      'house_nights_state_check',
      sql`${table.state} in ('scheduled', 'live', 'ended', 'cancelled')`,
    ),
    check(
      'house_nights_lifecycle_times_check',
      sql`(
        (${table.state} in ('scheduled', 'cancelled') and ${table.startedAt} is null and ${table.endedAt} is null)
        or (${table.state} = 'live' and ${table.startedAt} is not null and ${table.endedAt} is null)
        or (
          ${table.state} = 'ended'
          and ${table.startedAt} is not null
          and ${table.endedAt} is not null
          and ${table.endedAt} >= ${table.startedAt}
        )
      )`,
    ),
    check('house_nights_chat_sequence_check', sql`${table.chatSequence} >= 0`),
  ],
);

/** [BM-020] Append-only audit history for privileged Night schedule edits. */
export const nightAudit = pgTable(
  'night_audit',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    nightId: uuid('night_id').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    action: text('action').notNull(),
    previousScheduledStart: timestamp('previous_scheduled_start', { withTimezone: true }).notNull(),
    previousScheduledEnd: timestamp('previous_scheduled_end', { withTimezone: true }).notNull(),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'night_audit_night_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.actorMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'night_audit_actor_house_fk',
    }).onDelete('restrict'),
    index('night_audit_house_created_idx').on(table.houseId, table.createdAt),
    index('night_audit_night_created_idx').on(table.nightId, table.createdAt),
    check('night_audit_action_check', sql`${table.action} in ('rescheduled', 'cancelled')`),
    check(
      'night_audit_previous_interval_check',
      sql`${table.previousScheduledEnd} > ${table.previousScheduledStart}`,
    ),
    check('night_audit_interval_check', sql`${table.scheduledEnd} > ${table.scheduledStart}`),
  ],
);

/** [BM-040] Durable, House-scoped Night chat with soft-delete moderation. */
export const houseMessages = pgTable(
  'house_messages',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    nightId: uuid('night_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    body: text('body').notNull(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByMembershipId: uuid('deleted_by_membership_id'),
  },
  (table) => [
    unique('house_messages_id_house_unique').on(table.id, table.houseId),
    uniqueIndex('house_messages_night_sequence_unique').on(table.nightId, table.sequence),
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'house_messages_night_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'house_messages_membership_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.deletedByMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'house_messages_deleted_by_house_fk',
    }).onDelete('restrict'),
    index('house_messages_night_recent_idx').on(table.houseId, table.nightId, desc(table.sequence)),
    check('house_messages_body_check', sql`char_length(${table.body}) between 1 and 2000`),
    check('house_messages_sequence_check', sql`${table.sequence} > 0`),
    check(
      'house_messages_deletion_state_check',
      sql`(
        (${table.deletedAt} is null and ${table.deletedByMembershipId} is null)
        or (${table.deletedAt} is not null and ${table.deletedByMembershipId} is not null)
      )`,
    ),
  ],
);

/** [BM-033] [DR-NIGHT-02/05] Server-timestamped durable Night attendance. */
export const nightAttendance = pgTable(
  'night_attendance',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    nightId: uuid('night_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    firstJoinedAt: timestamp('first_joined_at', { withTimezone: true }).notNull(),
    currentJoinedAt: timestamp('current_joined_at', { withTimezone: true }),
    lastLeftAt: timestamp('last_left_at', { withTimezone: true }),
    accumulatedSeconds: integer('accumulated_seconds').default(0).notNull(),
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    qualificationReason: text('qualification_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('night_attendance_night_membership_unique').on(table.nightId, table.membershipId),
    unique('night_attendance_id_house_unique').on(table.id, table.houseId),
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'night_attendance_night_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'night_attendance_membership_house_fk',
    }).onDelete('restrict'),
    index('night_attendance_house_night_idx').on(table.houseId, table.nightId),
    index('night_attendance_membership_idx').on(table.membershipId, table.nightId),
    check('night_attendance_accumulated_check', sql`${table.accumulatedSeconds} >= 0`),
    check(
      'night_attendance_current_join_check',
      sql`${table.currentJoinedAt} is null or ${table.currentJoinedAt} >= ${table.firstJoinedAt}`,
    ),
    check(
      'night_attendance_last_leave_check',
      sql`${table.lastLeftAt} is null or ${table.lastLeftAt} >= ${table.firstJoinedAt}`,
    ),
    check(
      'night_attendance_qualification_pair_check',
      sql`(${table.qualifiedAt} is null) = (${table.qualificationReason} is null)`,
    ),
    check(
      'night_attendance_qualification_reason_check',
      sql`${table.qualificationReason} is null or ${table.qualificationReason} in ('duration', 'completed_live_game')`,
    ),
    check(
      'night_attendance_qualified_at_check',
      sql`${table.qualifiedAt} is null or ${table.qualifiedAt} >= ${table.firstJoinedAt}`,
    ),
  ],
);

/** [BM-036] [DR-NIGHT-02] Append-only server-timestamped Night join/leave events. */
export const nightAttendanceEvents = pgTable(
  'night_attendance_events',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    attendanceId: uuid('attendance_id').notNull(),
    nightId: uuid('night_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('night_attendance_events_id_house_unique').on(table.id, table.houseId),
    foreignKey({
      columns: [table.attendanceId, table.houseId],
      foreignColumns: [nightAttendance.id, nightAttendance.houseId],
      name: 'night_attendance_events_attendance_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'night_attendance_events_night_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'night_attendance_events_membership_house_fk',
    }).onDelete('restrict'),
    index('night_attendance_events_house_night_idx').on(table.houseId, table.nightId),
    index('night_attendance_events_attendance_occurred_idx').on(
      table.attendanceId,
      table.occurredAt,
    ),
    index('night_attendance_events_membership_idx').on(table.membershipId, table.nightId),
    check('night_attendance_events_kind_check', sql`${table.kind} in ('join', 'leave')`),
  ],
);

/** [BM-035] House-scoped RSVP intent for one Night and Member. */
export const nightRsvps = pgTable(
  'night_rsvps',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    nightId: uuid('night_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    status: text('status').notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('night_rsvps_night_membership_unique').on(table.nightId, table.membershipId),
    unique('night_rsvps_id_house_unique').on(table.id, table.houseId),
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'night_rsvps_night_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'night_rsvps_membership_house_fk',
    }).onDelete('restrict'),
    index('night_rsvps_house_night_idx').on(table.houseId, table.nightId),
    index('night_rsvps_membership_idx').on(table.membershipId, table.nightId),
    check('night_rsvps_status_check', sql`${table.status} in ('going', 'not_going')`),
  ],
);

/** [BM-034] [DR-SCORE-01..08] Immutable, explainable Season points. */
export const seasonScoreLedger = pgTable(
  'season_score_ledger',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceKey: text('source_key').notNull(),
    points: integer('points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'season_score_ledger_season_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'season_score_ledger_membership_house_fk',
    }).onDelete('restrict'),
    unique('season_score_ledger_source_unique').on(
      table.seasonId,
      table.membershipId,
      table.sourceKey,
    ),
    index('season_score_ledger_season_membership_idx').on(table.seasonId, table.membershipId),
    index('season_score_ledger_house_season_idx').on(table.houseId, table.seasonId),
    check(
      'season_score_ledger_source_kind_check',
      sql`${table.sourceKind} in ('game_played', 'game_win', 'game_draw', 'night_attendance', 'puzzle_published')`,
    ),
    check(
      'season_score_ledger_fixed_points_check',
      sql`(${table.sourceKind} = 'game_win' and ${table.points} = 3) or (${table.sourceKind} = 'game_draw' and ${table.points} = 2) or (${table.sourceKind} not in ('game_win', 'game_draw') and ${table.points} = 1)`,
    ),
    check(
      'season_score_ledger_source_key_length_check',
      sql`char_length(${table.sourceKey}) between 1 and 200`,
    ),
  ],
);

/** [BM-047] Immutable standings snapshot written when a Season enters `closing`. */
export const seasonFinalStandings = pgTable(
  'season_final_standings',
  {
    seasonId: uuid('season_id').notNull(),
    houseId: uuid('house_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    rank: integer('rank').notNull(),
    points: integer('points').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.seasonId, table.membershipId],
      name: 'season_final_standings_pkey',
    }),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'season_final_standings_season_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'season_final_standings_membership_house_fk',
    }).onDelete('restrict'),
    index('season_final_standings_house_season_rank_idx').on(
      table.houseId,
      table.seasonId,
      table.rank,
    ),
    check('season_final_standings_rank_check', sql`${table.rank} > 0`),
    check('season_final_standings_points_check', sql`${table.points} >= 0`),
  ],
);

const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** [BM-021] [DR-GAME-01..04] Current, server-authoritative Game snapshot. */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id').notNull(),
    nightId: uuid('night_id'),
    mode: text('mode').notNull(),
    state: text('state').default('waiting').notNull(),
    whiteMembershipId: uuid('white_membership_id'),
    blackMembershipId: uuid('black_membership_id'),
    initialFen: text('initial_fen').default(standardFen).notNull(),
    currentFen: text('current_fen').default(standardFen).notNull(),
    currentPly: integer('current_ply').default(0).notNull(),
    sideToMove: text('side_to_move').default('white').notNull(),
    result: text('result'),
    resultReason: text('result_reason'),
    version: integer('version').default(0).notNull(),
    outboxSequence: bigint('outbox_sequence', { mode: 'bigint' }).default(0n).notNull(),
    clockPolicy: jsonb('clock_policy').$type<ClockPolicy>().notNull(),
    whiteClockMs: integer('white_clock_ms'),
    blackClockMs: integer('black_clock_ms'),
    turnStartedAt: timestamp('turn_started_at', { withTimezone: true }),
    moveDueAt: timestamp('move_due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    seasonCompletionSequence: bigint('season_completion_sequence', { mode: 'bigint' }),
    drawOfferMembershipId: uuid('draw_offer_membership_id'),
    drawOfferPly: integer('draw_offer_ply'),
  },
  (table) => [
    unique('games_id_house_unique').on(table.id, table.houseId),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'games_season_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.nightId, table.houseId],
      foreignColumns: [houseNights.id, houseNights.houseId],
      name: 'games_night_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.whiteMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'games_white_membership_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.blackMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'games_black_membership_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.drawOfferMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'games_draw_offer_membership_house_fk',
    }).onDelete('restrict'),
    index('games_house_season_state_idx').on(table.houseId, table.seasonId, table.state),
    index('games_night_state_idx')
      .on(table.nightId, table.state)
      .where(sql`${table.nightId} is not null`),
    index('games_white_move_shelf_idx')
      .on(table.whiteMembershipId, table.state, table.moveDueAt)
      .where(sql`${table.state} = 'active' and ${table.mode} = 'correspondence'`),
    index('games_black_move_shelf_idx')
      .on(table.blackMembershipId, table.state, table.moveDueAt)
      .where(sql`${table.state} = 'active' and ${table.mode} = 'correspondence'`),
    unique('games_season_completion_sequence_unique').on(
      table.seasonId,
      table.seasonCompletionSequence,
    ),
    check('games_mode_check', sql`${table.mode} in ('correspondence', 'live')`),
    check(
      'games_state_check',
      sql`${table.state} in ('waiting', 'active', 'completed', 'cancelled')`,
    ),
    check('games_side_to_move_check', sql`${table.sideToMove} in ('white', 'black')`),
    check('games_outbox_sequence_check', sql`${table.outboxSequence} >= 0`),
    check(
      'games_season_completion_sequence_check',
      sql`${table.seasonCompletionSequence} is null or ${table.seasonCompletionSequence} > 0`,
    ),
    check(
      'games_result_check',
      sql`${table.result} is null or ${table.result} in ('white_win', 'black_win', 'draw', 'aborted')`,
    ),
    check(
      'games_result_reason_check',
      sql`${table.resultReason} is null or ${table.resultReason} in ('checkmate', 'stalemate', 'insufficient_material', 'repetition', 'fifty_move', 'flag', 'resign', 'agreement', 'timeout', 'abort')`,
    ),
    check(
      'games_distinct_memberships_check',
      sql`${table.whiteMembershipId} is null or ${table.blackMembershipId} is null or ${table.whiteMembershipId} <> ${table.blackMembershipId}`,
    ),
    check(
      'games_active_seats_check',
      sql`${table.state} <> 'active' or (${table.whiteMembershipId} is not null and ${table.blackMembershipId} is not null)`,
    ),
    check('games_position_counters_check', sql`${table.currentPly} >= 0 and ${table.version} >= 0`),
    check(
      'games_draw_offer_shape_check',
      sql`(${table.drawOfferMembershipId} is null and ${table.drawOfferPly} is null)
        or (${table.state} = 'active' and ${table.drawOfferMembershipId} is not null
          and ${table.drawOfferMembershipId} in (${table.whiteMembershipId}, ${table.blackMembershipId})
          and ${table.drawOfferPly} = ${table.currentPly} and ${table.drawOfferPly} >= 0)`,
    ),
    check('games_night_mode_check', sql`${table.nightId} is null or ${table.mode} = 'live'`),
    check(
      'games_clock_policy_shape_check',
      sql`(case
        when ${table.mode} = 'correspondence' then
          jsonb_typeof(${table.clockPolicy}) = 'object'
          and ${table.clockPolicy}->>'kind' = 'correspondence'
          and (${table.clockPolicy} - 'kind' - 'perMoveHours') = '{}'::jsonb
          and case when jsonb_typeof(${table.clockPolicy}->'perMoveHours') = 'number'
            then (${table.clockPolicy}->>'perMoveHours')::numeric > 0
              and mod((${table.clockPolicy}->>'perMoveHours')::numeric, 1) = 0
            else false end
        when ${table.mode} = 'live' then
          jsonb_typeof(${table.clockPolicy}) = 'object'
          and ${table.clockPolicy}->>'kind' = 'live'
          and (${table.clockPolicy} - 'kind' - 'initialMs' - 'incrementMs') = '{}'::jsonb
          and case when jsonb_typeof(${table.clockPolicy}->'initialMs') = 'number'
            then (${table.clockPolicy}->>'initialMs')::numeric >= 180000
              and mod((${table.clockPolicy}->>'initialMs')::numeric, 1) = 0
            else false end
          and case when jsonb_typeof(${table.clockPolicy}->'incrementMs') = 'number'
            then (${table.clockPolicy}->>'incrementMs')::numeric >= 0
              and mod((${table.clockPolicy}->>'incrementMs')::numeric, 1) = 0
            else false end
        else false
      end) is true`,
    ),
    check(
      'games_clock_columns_check',
      sql`(${table.mode} = 'correspondence' and ${table.whiteClockMs} is null and ${table.blackClockMs} is null and ${table.turnStartedAt} is null)
        or (${table.mode} = 'live' and ${table.whiteClockMs} is not null and ${table.whiteClockMs} >= 0
          and ${table.blackClockMs} is not null and ${table.blackClockMs} >= 0 and ${table.moveDueAt} is null)`,
    ),
  ],
);

/** [BM-044] Durable engine work, separate from the completed Game. */
export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: uuid('id').primaryKey().notNull(),
    sourceEventId: uuid('source_event_id').notNull().unique('analysis_jobs_source_event_id_unique'),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id').notNull(),
    engineVersion: text('engine_version').notNull(),
    state: text('state').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    result: jsonb('result'),
    lastError: text('last_error'),
    lastFailureToken: uuid('last_failure_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'analysis_jobs_game_house_fk',
    }).onDelete('restrict'),
    unique('analysis_jobs_id_house_unique').on(table.id, table.houseId),
    index('analysis_jobs_claim_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.state} in ('pending', 'leased')`),
    check(
      'analysis_jobs_engine_version_check',
      sql`char_length(${table.engineVersion}) between 1 and 100`,
    ),
    check(
      'analysis_jobs_state_check',
      sql`${table.state} in ('pending', 'leased', 'completed', 'failed')`,
    ),
    check('analysis_jobs_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'analysis_jobs_lease_shape_check',
      sql`(${table.state} = 'leased' and ${table.leaseToken} is not null and ${table.leaseUntil} is not null) or (${table.state} <> 'leased' and ${table.leaseToken} is null and ${table.leaseUntil} is null)`,
    ),
    check(
      'analysis_jobs_completion_shape_check',
      sql`(${table.state} = 'completed' and ${table.result} is not null and ${table.completedAt} is not null) or (${table.state} <> 'completed' and ${table.result} is null and ${table.completedAt} is null)`,
    ),
    check(
      'analysis_jobs_error_length_check',
      sql`${table.lastError} is null or char_length(${table.lastError}) between 1 and 2000`,
    ),
  ],
);

/** [BM-045] An unpublished House Puzzle moment, scoped to its source Season. */
export const puzzleCandidates = pgTable(
  'puzzle_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    analysisJobId: uuid('analysis_job_id').notNull(),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    sourcePly: integer('source_ply').notNull(),
    positionFen: text('position_fen').notNull(),
    bestLine: jsonb('best_line').$type<string[]>().notNull(),
    evaluationSwingCp: integer('evaluation_swing_cp').notNull(),
    state: text('state').default('pending').notNull(),
    reviewerMembershipId: uuid('reviewer_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.analysisJobId, table.houseId],
      foreignColumns: [analysisJobs.id, analysisJobs.houseId],
      name: 'puzzle_candidates_analysis_job_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'puzzle_candidates_game_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'puzzle_candidates_season_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.reviewerMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'puzzle_candidates_reviewer_house_fk',
    }).onDelete('restrict'),
    unique('puzzle_candidates_game_ply_unique').on(table.gameId, table.sourcePly),
    unique('puzzle_candidates_id_house_unique').on(table.id, table.houseId),
    index('puzzle_candidates_house_season_state_idx').on(
      table.houseId,
      table.seasonId,
      table.state,
      desc(table.createdAt),
    ),
    check('puzzle_candidates_source_ply_check', sql`${table.sourcePly} > 0`),
    check(
      'puzzle_candidates_position_fen_check',
      sql`char_length(${table.positionFen}) between 1 and 200`,
    ),
    check('puzzle_candidates_best_line_check', sql`jsonb_typeof(${table.bestLine}) = 'array'`),
    check('puzzle_candidates_evaluation_swing_cp_check', sql`${table.evaluationSwingCp} >= 200`),
    check(
      'puzzle_candidates_state_check',
      sql`${table.state} in ('pending', 'confirmed', 'rejected')`,
    ),
  ],
);

/** [BM-046] A confirmed, House-visible position and prompt. */
export const housePuzzles = pgTable(
  'house_puzzles',
  {
    id: uuid('id').primaryKey().notNull(),
    candidateId: uuid('candidate_id').notNull().unique(),
    houseId: uuid('house_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    gameId: uuid('game_id').notNull(),
    positionFen: text('position_fen').notNull(),
    prompt: text('prompt').notNull(),
    contributorMembershipId: uuid('contributor_membership_id').notNull(),
    confirmedByMembershipId: uuid('confirmed_by_membership_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('house_puzzles_house_id_unique').on(table.id, table.houseId),
    foreignKey({
      columns: [table.candidateId, table.houseId],
      foreignColumns: [puzzleCandidates.id, puzzleCandidates.houseId],
      name: 'house_puzzles_candidate_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'house_puzzles_season_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'house_puzzles_game_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.contributorMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'house_puzzles_contributor_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.confirmedByMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'house_puzzles_reviewer_house_fk',
    }).onDelete('restrict'),
    index('house_puzzles_house_published_idx').on(table.houseId, desc(table.publishedAt)),
    check(
      'house_puzzles_position_fen_check',
      sql`char_length(${table.positionFen}) between 1 and 200`,
    ),
    check('house_puzzles_prompt_check', sql`char_length(${table.prompt}) between 1 and 280`),
  ],
);

/** [BM-048] One Closing Book per Season, generated privately and then published to the House. */
export const closingBooks = pgTable(
  'closing_books',
  {
    id: uuid('id').primaryKey().notNull(),
    houseId: uuid('house_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    generationVersion: integer('generation_version').notNull(),
    state: text('state').notNull().default('generated'),
    payload: jsonb('payload').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('closing_books_season_unique').on(table.seasonId),
    unique('closing_books_source_event_unique').on(table.sourceEventId),
    foreignKey({
      columns: [table.seasonId, table.houseId],
      foreignColumns: [seasons.id, seasons.houseId],
      name: 'closing_books_season_house_fk',
    }).onDelete('cascade'),
    check('closing_books_id_check', sql`is_uuid_v7(${table.id})`),
    check('closing_books_generation_version_check', sql`${table.generationVersion} > 0`),
    check('closing_books_state_check', sql`${table.state} in ('generated', 'published')`),
    check('closing_books_payload_check', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      'closing_books_publication_shape_check',
      sql`(${table.state} = 'generated' and ${table.publishedAt} is null)
        or (${table.state} = 'published' and ${table.publishedAt} is not null
          and ${table.publishedAt} >= ${table.generatedAt})`,
    ),
  ],
);

/** [BM-029] [DR-CORR-04] One durable delivery record per Nudge natural key. */
export const nudgeDeliveries = pgTable(
  'nudge_deliveries',
  {
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    ply: integer('ply').notNull(),
    recipientMembershipId: uuid('recipient_membership_id').notNull(),
    stage: text('stage').notNull(),
    moveDueAt: timestamp('move_due_at', { withTimezone: true }).notNull(),
    outboxEventId: uuid('outbox_event_id').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.gameId, table.ply, table.recipientMembershipId, table.stage],
    }),
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'nudge_deliveries_game_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.recipientMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'nudge_deliveries_recipient_house_fk',
    }).onDelete('restrict'),
    index('nudge_deliveries_house_created_idx').on(table.houseId, table.createdAt),
    check('nudge_deliveries_ply_check', sql`${table.ply} >= 0`),
    check('nudge_deliveries_stage_check', sql`${table.stage} in ('advance', 'overdue')`),
    check('nudge_deliveries_outbox_event_uuid_v7_check', sql`is_uuid_v7(${table.outboxEventId})`),
  ],
);

/** [BM-028] [DR-DRAW-02] Durable idempotency ledger for resignation and draw commands. */
export const gameLifecycleCommands = pgTable(
  'game_lifecycle_commands',
  {
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    clientCommandId: uuid('client_command_id').notNull(),
    action: text('action').notNull(),
    commandPly: integer('command_ply').notNull(),
    outcome: jsonb('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.clientCommandId] }),
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'game_lifecycle_commands_game_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.actorMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'game_lifecycle_commands_actor_house_fk',
    }).onDelete('restrict'),
    index('game_lifecycle_commands_house_game_idx').on(table.houseId, table.gameId),
    check(
      'game_lifecycle_commands_action_check',
      sql`${table.action} in ('resign', 'draw_offer', 'draw_accept')`,
    ),
    check('game_lifecycle_commands_ply_check', sql`${table.commandPly} >= 0`),
    check(
      'game_lifecycle_commands_client_command_uuid_v7_check',
      sql`is_uuid_v7(${table.clientCommandId})`,
    ),
  ],
);

/** [BM-021] [DR-SEAT-01..03] One House-scoped invitation to occupy a Game side. */
export const openSeats = pgTable(
  'open_seats',
  {
    id: uuid('id').primaryKey().notNull(),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    offeredColor: text('offered_color').notNull(),
    creatorMembershipId: uuid('creator_membership_id').notNull(),
    intendedMembershipId: uuid('intended_membership_id'),
    creationIdempotencyDigest: text('creation_idempotency_digest'),
    creationPayloadDigest: text('creation_payload_digest'),
    state: text('state').default('open').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'open_seats_game_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.creatorMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'open_seats_creator_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.intendedMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'open_seats_intended_house_fk',
    }).onDelete('restrict'),
    uniqueIndex('open_seats_one_open_per_game')
      .on(table.gameId)
      .where(sql`${table.state} = 'open'`),
    uniqueIndex('open_seats_creator_idempotency_unique')
      .on(table.houseId, table.creatorMembershipId, table.creationIdempotencyDigest)
      .where(sql`${table.creationIdempotencyDigest} is not null`),
    index('open_seats_house_state_expiry_idx').on(table.houseId, table.state, table.expiresAt),
    check('open_seats_color_check', sql`${table.offeredColor} in ('white', 'black', 'any')`),
    check(
      'open_seats_state_check',
      sql`${table.state} in ('open', 'accepted', 'expired', 'cancelled')`,
    ),
    check('open_seats_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'open_seats_creation_idempotency_digest_check',
      sql`${table.creationIdempotencyDigest} is null or ${table.creationIdempotencyDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'open_seats_creation_payload_digest_check',
      sql`${table.creationPayloadDigest} is null or ${table.creationPayloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'open_seats_creation_idempotency_pair_check',
      sql`(${table.creationIdempotencyDigest} is null) = (${table.creationPayloadDigest} is null)`,
    ),
  ],
);

/** [BM-021] [DR-MOVE-03] Immutable canonical Move record. */
export const moves = pgTable(
  'moves',
  {
    id: uuid('id').primaryKey().notNull(),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    ply: integer('ply').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    uci: text('uci').notNull(),
    san: text('san').notNull(),
    fenAfter: text('fen_after').notNull(),
    clientCommandId: uuid('client_command_id').notNull(),
    acceptedVersion: integer('accepted_version').notNull(),
    serverReceivedAt: timestamp('server_received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    clockSnapshot: jsonb('clock_snapshot').$type<{ whiteMs: number; blackMs: number }>(),
  },
  (table) => [
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'moves_game_house_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.actorMembershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'moves_actor_house_fk',
    }).onDelete('restrict'),
    uniqueIndex('moves_game_ply_unique').on(table.gameId, table.ply),
    uniqueIndex('moves_game_command_unique').on(table.gameId, table.clientCommandId),
    uniqueIndex('moves_game_accepted_version_unique').on(table.gameId, table.acceptedVersion),
    check('moves_ply_check', sql`${table.ply} > 0`),
    check('moves_accepted_version_check', sql`${table.acceptedVersion} > 0`),
    check('moves_client_command_uuid_v7_check', sql`is_uuid_v7(${table.clientCommandId})`),
    check('moves_uci_check', sql`${table.uci} ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'`),
    check('moves_san_check', sql`char_length(${table.san}) between 1 and 32`),
  ],
);

/** [BM-021] [DR-REACT-01] One current Reaction per Member and completed Game. */
export const gameReactions = pgTable(
  'game_reactions',
  {
    id: uuid('id').primaryKey().notNull(),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    reaction: text('reaction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'game_reactions_game_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'game_reactions_membership_house_fk',
    }).onDelete('restrict'),
    uniqueIndex('game_reactions_game_membership_unique').on(table.gameId, table.membershipId),
    check(
      'game_reactions_value_check',
      sql`${table.reaction} in ('well_played', 'brilliant', 'dramatic', 'funny')`,
    ),
  ],
);

/** [BM-021] [DR-NOTE-01] One bounded, plain-text Game note per Member. */
export const gameNotes = pgTable(
  'game_notes',
  {
    id: uuid('id').primaryKey().notNull(),
    gameId: uuid('game_id').notNull(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.gameId, table.houseId],
      foreignColumns: [games.id, games.houseId],
      name: 'game_notes_game_house_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.membershipId, table.houseId],
      foreignColumns: [memberships.id, memberships.houseId],
      name: 'game_notes_membership_house_fk',
    }).onDelete('restrict'),
    uniqueIndex('game_notes_game_membership_unique').on(table.gameId, table.membershipId),
    check('game_notes_body_check', sql`char_length(${table.body}) between 1 and 2000`),
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
