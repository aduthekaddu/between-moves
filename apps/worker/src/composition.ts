import {
  AesGcmMagicLinkDeliveryCodec,
  AesGcmInvitationEmailDeliveryCodec,
  generateUuidV7,
  IdempotentLoggingConsumer,
  ResendMagicLinkEmailSender,
  ResendInvitationEmailSender,
  ResendNudgeEmailSender,
  SystemClock,
} from '@between-moves/adapters';
import {
  createMagicLinkEmailConsumer,
  createEmailDeliveryConsumer,
  createInvitationEmailConsumer,
  createNudgeDispatcher,
  createNudgeEmailConsumer,
  createOutboxDispatcher,
  createSeasonScoringConsumer,
  MAGIC_LINK_EMAIL_TOPIC,
  type DispatchSummary,
  type NudgeDispatchSummary,
} from '@between-moves/application';
import {
  createDatabase,
  PgNudgeEmailReader,
  PgNudgeRepository,
  PgOutboxRepository,
  PgSeasonScoringRepository,
} from '@between-moves/db';
import {
  GAME_COMPLETED_SCORING_TOPIC,
  INVITATION_EMAIL_TOPIC,
  NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
  NUDGE_DUE_TOPIC,
  PUZZLE_PUBLISHED_SCORING_TOPIC,
  type OutboxConsumer,
} from '@between-moves/domain';
import {
  createDeliveryMetricStubs,
  createSeasonScoringEventRecorder,
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
  const database = createDatabase(requiredEnvironment('DATABASE_URL'));

  try {
    const fallback = new IdempotentLoggingConsumer(logger);
    const secret = requiredEnvironment('BETTER_AUTH_SECRET');
    const apiKey = requiredEnvironment('RESEND_API_KEY');
    const magicLink = createMagicLinkEmailConsumer({
      codec: new AesGcmMagicLinkDeliveryCodec(secret),
      sender: new ResendMagicLinkEmailSender({
        apiKey,
        from: 'Between Moves <sign-in@betweenmoves.app>',
        metrics,
      }),
    });
    const invitation = createInvitationEmailConsumer({
      codec: new AesGcmInvitationEmailDeliveryCodec(secret),
      sender: new ResendInvitationEmailSender({
        apiKey,
        from: 'Between Moves <invitations@betweenmoves.app>',
        metrics,
      }),
    });
    const nudge = createNudgeEmailConsumer({
      clock,
      reader: new PgNudgeEmailReader(database.pool),
      sender: new ResendNudgeEmailSender({
        apiKey,
        from: 'Between Moves <nudges@betweenmoves.app>',
        metrics,
      }),
      metrics,
    });
    const email = createEmailDeliveryConsumer({ clock, magicLink, invitation, nudge });
    const scoring = createSeasonScoringConsumer({
      scoring: new PgSeasonScoringRepository(database.pool),
      ids: { generate: () => generateUuidV7() },
      events: createSeasonScoringEventRecorder({ logger }),
      clock,
    });
    const emailTopics = new Set([MAGIC_LINK_EMAIL_TOPIC, INVITATION_EMAIL_TOPIC, NUDGE_DUE_TOPIC]);
    const scoringTopics = new Set([
      GAME_COMPLETED_SCORING_TOPIC,
      NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
      PUZZLE_PUBLISHED_SCORING_TOPIC,
    ]);
    const consumer: OutboxConsumer = {
      consume: (event) => {
        if (emailTopics.has(event.topic)) return email.consume(event);
        if (scoringTopics.has(event.topic)) return scoring.consume(event);
        return fallback.consume(event);
      },
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
      data: { ...summary, ...metrics.snapshot() },
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
