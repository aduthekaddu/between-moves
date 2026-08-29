import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
