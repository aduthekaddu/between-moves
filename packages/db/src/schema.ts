import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

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
