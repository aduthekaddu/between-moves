import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueOutboxEvent } from './enqueue-outbox-event';
import { migrateDown, migrateUp } from './migrations';
import { PgOutboxRepository } from './outbox-repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const NOW = new Date('2026-08-29T10:00:00.000Z');

function event(id: string, sequence: bigint) {
  return {
    id,
    topic: 'game.move-accepted',
    aggregateId: '01941f29-7c00-7000-8000-000000000302',
    sequence,
    houseId: '01941f29-7c00-7000-8000-000000000303',
    payload: { ply: Number(sequence) },
    availableAt: NOW,
    occurredAt: new Date(NOW.getTime() - 5_000),
  };
}

integration('PostgreSQL outbox', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgOutboxRepository(database);

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
  });

  beforeEach(async () => {
    await database.query('delete from outbox_events');
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-006] DR-DELIV-01 does not retain an outbox event when its transaction rolls back', async () => {
    const transaction = await database.connect();
    try {
      await transaction.query('begin');
      await enqueueOutboxEvent(event('01941f29-7c00-7000-8000-000000000301', 1n), transaction);
      await transaction.query('rollback');
    } finally {
      transaction.release();
    }

    const result = await database.query<{ count: string }>('select count(*) from outbox_events');
    expect(result.rows[0]?.count).toBe('0');
  });

  it('[BM-006] DR-DELIV-01 claims a committed event with a lease and marks it sent', async () => {
    await enqueueOutboxEvent(event('01941f29-7c00-7000-8000-000000000311', 1n), database);

    const claimed = await repository.claimBatch({
      now: NOW,
      leaseUntil: new Date(NOW.getTime() + 30_000),
      limit: 10,
      maxAttempts: 8,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: '01941f29-7c00-7000-8000-000000000311',
      attempts: 1,
    });

    await repository.markSent(claimed[0]!.id, NOW);
    const row = await database.query<{ sent_at: Date | null }>(
      'select sent_at from outbox_events where id = $1',
      [claimed[0]!.id],
    );
    expect(row.rows[0]?.sent_at).toEqual(NOW);
  });

  it('[BM-006] DR-DELIV-01 gives concurrent claimers distinct rows with SKIP LOCKED', async () => {
    await enqueueOutboxEvent(event('01941f29-7c00-7000-8000-000000000321', 1n), database);
    await enqueueOutboxEvent(event('01941f29-7c00-7000-8000-000000000322', 2n), database);

    const claim = () =>
      repository.claimBatch({
        now: NOW,
        leaseUntil: new Date(NOW.getTime() + 30_000),
        limit: 1,
        maxAttempts: 8,
      });
    const [first, second] = await Promise.all([claim(), claim()]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });
});
