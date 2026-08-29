import { IdempotentLoggingConsumer, SystemClock } from '@between-moves/adapters';
import { createOutboxDispatcher, type DispatchSummary } from '@between-moves/application';
import { createDatabase, PgOutboxRepository } from '@between-moves/db';
import { createDeliveryMetricStubs, createStructuredLogger } from '@between-moves/observability';

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Missing required configuration key: DATABASE_URL');
  return value;
}

/** [BM-006] Trigger.dev composition root; no application/domain policy lives here. */
export async function runOutboxDispatcher(): Promise<DispatchSummary> {
  const clock = new SystemClock();
  const logger = createStructuredLogger({ clock, sink: (line) => console.log(line) });
  const metrics = createDeliveryMetricStubs();
  const database = createDatabase(databaseUrl());

  try {
    const dispatcher = createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database.pool),
      consumer: new IdempotentLoggingConsumer(logger),
      metrics,
    });
    const summary = await dispatcher.dispatchAvailable();
    logger.log({
      level: 'info',
      requestId: 'worker',
      actorId: 'anonymous',
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'delivery.outbox-dispatch-complete',
      outcome: 'success',
      durationMs: 0,
      data: { ...summary, ...metrics.snapshot() },
    });
    return summary;
  } finally {
    await database.close();
  }
}
