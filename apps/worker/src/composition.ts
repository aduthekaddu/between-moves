import {
  AesGcmMagicLinkDeliveryCodec,
  generateUuidV7,
  IdempotentLoggingConsumer,
  ResendMagicLinkEmailSender,
  ResendNudgeEmailSender,
  SystemClock,
} from '@between-moves/adapters';
import {
  createMagicLinkEmailConsumer,
  createNudgeDispatcher,
  createNudgeEmailConsumer,
  createOutboxDispatcher,
  MAGIC_LINK_EMAIL_TOPIC,
  type DispatchSummary,
  type NudgeDispatchSummary,
} from '@between-moves/application';
import {
  createDatabase,
  PgNudgeEmailReader,
  PgNudgeRepository,
  PgOutboxRepository,
} from '@between-moves/db';
import { NUDGE_DUE_TOPIC, type OutboxConsumer } from '@between-moves/domain';
import {
  createDeliveryMetricStubs,
  createIdentityMetricStubs,
  createStructuredLogger,
} from '@between-moves/observability';

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required configuration key: ${key}`);
  return value;
}

/** [BM-006/008] Trigger.dev composition root; no application/domain policy lives here. */
export async function runOutboxDispatcher(): Promise<DispatchSummary> {
  const clock = new SystemClock();
  const logger = createStructuredLogger({ clock, sink: (line) => console.log(line) });
  const metrics = createDeliveryMetricStubs();
  const identityMetrics = createIdentityMetricStubs();
  const database = createDatabase(requiredEnvironment('DATABASE_URL'));

  try {
    const fallback = new IdempotentLoggingConsumer(logger);
    const magicLink = createMagicLinkEmailConsumer({
      codec: new AesGcmMagicLinkDeliveryCodec(requiredEnvironment('BETTER_AUTH_SECRET')),
      sender: new ResendMagicLinkEmailSender({
        apiKey: requiredEnvironment('RESEND_API_KEY'),
        from: 'Between Moves <sign-in@betweenmoves.app>',
        metrics: identityMetrics,
      }),
    });
    const nudge = createNudgeEmailConsumer({
      clock,
      reader: new PgNudgeEmailReader(database.pool),
      sender: new ResendNudgeEmailSender({
        apiKey: requiredEnvironment('RESEND_API_KEY'),
        from: 'Between Moves <nudges@betweenmoves.app>',
      }),
      metrics,
    });
    const consumer: OutboxConsumer = {
      consume: (event) =>
        event.topic === MAGIC_LINK_EMAIL_TOPIC
          ? magicLink.consume(event)
          : event.topic === NUDGE_DUE_TOPIC
            ? nudge.consume(event)
            : fallback.consume(event),
    };
    const dispatcher = createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database.pool),
      consumer,
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
      data: { ...summary, ...metrics.snapshot(), ...identityMetrics.snapshot() },
    });
    return summary;
  } finally {
    await database.close();
  }
}

/** [BM-029] Scheduled, bounded Nudge scan composed only at the worker edge. */
export async function runNudgeDispatcher(): Promise<NudgeDispatchSummary> {
  const clock = new SystemClock();
  const logger = createStructuredLogger({ clock, sink: (line) => console.log(line) });
  const metrics = createDeliveryMetricStubs();
  const database = createDatabase(requiredEnvironment('DATABASE_URL'));

  try {
    const summary = await createNudgeDispatcher({
      clock,
      generateId: () => generateUuidV7(clock.now().getTime()),
      repository: new PgNudgeRepository(database.pool),
      metrics,
    }).dispatch();
    logger.log({
      level: 'info',
      requestId: 'worker',
      actorId: 'anonymous',
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'delivery.nudge-dispatch-complete',
      outcome: 'success',
      durationMs: 0,
      data: { ...summary, ...metrics.snapshot() },
    });
    return summary;
  } finally {
    await database.close();
  }
}
