import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgEmailDeliveryEventRepository } from './email-delivery-event-repository';
import { migrateDown, migrateUp } from './migrations';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

describe('PostgreSQL email delivery events', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgEmailDeliveryEventRepository(database);

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-030] [DR-DELIV-01] persists one metadata-only effect for a duplicate webhook', async () => {
    const event = {
      id: 'msg_123',
      type: 'email.delivered' as const,
      emailId: 'email_123',
      occurredAt: new Date('2026-09-16T10:00:00.000Z'),
    };
    const receivedAt = new Date('2026-09-16T10:01:00.000Z');

    await expect(repository.record(event, receivedAt)).resolves.toBe('processed');
    await expect(repository.record(event, receivedAt)).resolves.toBe('duplicate');
    const rows = await database.query(
      'select id, event_type, email_id, occurred_at, received_at from email_delivery_events',
    );
    expect(rows.rows).toEqual([
      {
        id: event.id,
        event_type: event.type,
        email_id: event.emailId,
        occurred_at: event.occurredAt,
        received_at: receivedAt,
      },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain('@');
  });
});
