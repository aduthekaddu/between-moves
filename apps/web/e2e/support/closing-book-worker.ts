/**
 * [BM-048] Run the worker's outbox path once for `season.closing`, in its own process as in
 * production. The Closing Book E2E spawns this through tsx: Playwright 1.51 leaves workspace
 * TypeScript to Node 24's strip-only loader, which cannot load the repositories' parameter
 * properties, so the spec must not import these packages itself.
 */
import { generateUuidV7 } from '@between-moves/adapters';
import { createClosingBookConsumer, createOutboxDispatcher } from '@between-moves/application';
import { PgClosingBookRepository, PgOutboxRepository } from '@between-moves/db';
import { createDatabase } from '@between-moves/db/database';
import { SEASON_CLOSING_TOPIC } from '@between-moves/domain';
import { createDeliveryMetricStubs } from '@between-moves/observability';

const database = createDatabase(process.env.TEST_DATABASE_URL ?? '');
try {
  const clock = { now: () => new Date() };
  const closingBook = createClosingBookConsumer({
    books: new PgClosingBookRepository(database.pool),
    ids: { generate: () => generateUuidV7() },
    clock,
    events: { record: () => undefined },
  });
  const summary = await createOutboxDispatcher({
    clock,
    repository: new PgOutboxRepository(database.pool),
    // Other topics are acknowledged, as the worker's logging fallback would.
    consumer: {
      consume: async (event) =>
        event.topic === SEASON_CLOSING_TOPIC ? closingBook.consume(event) : 'processed',
    },
    metrics: createDeliveryMetricStubs(),
  }).dispatchAvailable();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await database.close();
}
