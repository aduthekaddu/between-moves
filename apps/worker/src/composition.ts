import {
  AesGcmMagicLinkDeliveryCodec,
  AesGcmInvitationEmailDeliveryCodec,
  generateUuidV7,
  HmacRealtimeChannelResolver,
  HttpRealtimePublisher,
  IdempotentLoggingConsumer,
  ResendMagicLinkEmailSender,
  ResendInvitationEmailSender,
  ResendNudgeEmailSender,
  SystemClock,
} from '@between-moves/adapters';
import {
  createClosingBookConsumer,
  createMagicLinkEmailConsumer,
  createEmailDeliveryConsumer,
  createInvitationEmailConsumer,
  createNudgeDispatcher,
  createNudgeEmailConsumer,
  createOutboxDispatcher,
  createRealtimePublishConsumer,
  createSeasonScoringConsumer,
  MAGIC_LINK_EMAIL_TOPIC,
  REALTIME_PUBLISH_TOPIC_SET,
  type DispatchSummary,
  type NudgeDispatchSummary,
} from '@between-moves/application';
import {
  createDatabase,
  PgAnalysisJobRepository,
  PgClosingBookRepository,
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
  SEASON_CLOSING_TOPIC,
  type OutboxConsumer,
} from '@between-moves/domain';
import {
  createDeliveryMetricStubs,
  createAnalysisMetricStubs,
  createClosingBookEventRecorder,
  createRealtimeMetricStubs,
  createSeasonScoringEventRecorder,
  createStructuredLogger,
} from '@between-moves/observability';
import { dispatchAnalysisJob, enqueueAnalysisRequest } from './modules/stories/analysis';

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
  const realtimeMetrics = createRealtimeMetricStubs();
  const database = createDatabase(requiredEnvironment('DATABASE_URL'));

  try {
    const fallback = new IdempotentLoggingConsumer(logger);
    const analysisJobs = new PgAnalysisJobRepository(database.pool);
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
    const closingBook = createClosingBookConsumer({
      books: new PgClosingBookRepository(database.pool),
      ids: { generate: () => generateUuidV7() },
      clock,
      events: createClosingBookEventRecorder({ logger }),
    });
    const emailTopics = new Set([MAGIC_LINK_EMAIL_TOPIC, INVITATION_EMAIL_TOPIC, NUDGE_DUE_TOPIC]);
    const scoringTopics = new Set([
      GAME_COMPLETED_SCORING_TOPIC,
      NIGHT_ATTENDANCE_QUALIFIED_TOPIC,
      PUZZLE_PUBLISHED_SCORING_TOPIC,
    ]);
    const appOrigin = process.env.APP_ORIGIN;
    const realtimeServerKey = process.env.REALTIME_SERVER_KEY;
    const realtime =
      appOrigin !== undefined &&
      appOrigin.length > 0 &&
      realtimeServerKey !== undefined &&
      realtimeServerKey.length > 0
        ? createRealtimePublishConsumer({
            clock,
            publisher: new HttpRealtimePublisher({
              url: new URL('/api/internal/realtime/publish', appOrigin).toString(),
              serverKey: realtimeServerKey,
            }),
            channels: new HmacRealtimeChannelResolver(realtimeServerKey),
            metrics: realtimeMetrics,
          })
        : null;
    const consumer: OutboxConsumer = {
      async consume(event) {
        if (emailTopics.has(event.topic)) return email.consume(event);
        if (event.topic === SEASON_CLOSING_TOPIC) return closingBook.consume(event);
        if (event.topic === 'game.analysis-requested') {
          return enqueueAnalysisRequest(event, analysisJobs, {
            enabled: process.env.ANALYSIS_ENABLED !== 'false',
            engineVersion: process.env.ANALYSIS_ENGINE_VERSION || 'v1',
            now: clock.now(),
          });
        }
        const scoringResult = scoringTopics.has(event.topic) ? await scoring.consume(event) : null;
        const realtimeResult =
          realtime !== null && REALTIME_PUBLISH_TOPIC_SET.has(event.topic)
            ? await realtime.consume(event)
            : null;
        if (scoringResult === null && realtimeResult === null) return fallback.consume(event);
        return scoringResult === 'processed' || realtimeResult === 'processed'
          ? 'processed'
          : 'duplicate';
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
      data: { ...summary, ...metrics.snapshot(), ...realtimeMetrics.snapshot() },
    });
    return summary;
  } finally {
    await database.close();
  }
}

/** [BM-044] Independent lease poller; engine health cannot delay Game completion. */
export async function runAnalysisWorker(): Promise<'disabled' | 'idle' | 'submitted' | 'retried'> {
  if (process.env.ANALYSIS_ENABLED === 'false') return 'disabled';
  const database = createDatabase(requiredEnvironment('DATABASE_URL'));
  const clock = new SystemClock();
  const metrics = createAnalysisMetricStubs();
  const logger = createStructuredLogger({ clock, sink: (line) => console.log(line) });
  const startedAt = clock.now();
  try {
    const outcome = await dispatchAnalysisJob({
      jobs: new PgAnalysisJobRepository(database.pool),
      engineUrl: new URL(requiredEnvironment('ANALYSIS_WORKER_URL')),
      callbackUrl: new URL('/api/internal/analysis/callback', requiredEnvironment('APP_ORIGIN')),
      secret: requiredEnvironment('ANALYSIS_WORKER_SECRET'),
      now: () => clock.now(),
      fetch,
      metrics,
    });
    logger.log({
      level: 'info',
      requestId: 'worker',
      actorId: 'anonymous',
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'analysis.job-dispatch',
      outcome: outcome === 'retried' ? 'error' : 'success',
      durationMs: Math.max(0, clock.now().getTime() - startedAt.getTime()),
      data: {
        result: outcome,
        analysis_job_failure_total: metrics.snapshot().analysis_job_failure_total,
      },
    });
    return outcome;
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
