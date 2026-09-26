import { signAnalysisCallback } from '@between-moves/adapters';
import type { AnalysisJob } from '@between-moves/db';

export interface AnalysisJobStore {
  expire(now: Date, maxAttempts: number): Promise<number>;
  claim(now: Date, leaseUntil: Date, maxAttempts: number): Promise<AnalysisJob | null>;
  fail(
    jobId: string,
    leaseToken: string,
    now: Date,
    maxAttempts: number,
    error: string,
  ): Promise<'processed' | 'duplicate' | 'stale'>;
}

export interface AnalysisRequestEvent {
  readonly id: string;
  readonly aggregateId: string;
  readonly houseId: string | null;
}

export async function enqueueAnalysisRequest(
  event: AnalysisRequestEvent,
  jobs: {
    enqueue(input: {
      eventId: string;
      gameId: string;
      houseId: string;
      engineVersion: string;
      now: Date;
    }): Promise<'enqueued' | 'duplicate'>;
  },
  options: { enabled: boolean; engineVersion: string; now: Date },
): Promise<'processed' | 'duplicate'> {
  if (!options.enabled) return 'processed';
  if (event.houseId === null) throw new Error('Analysis event is missing its House');
  const outcome = await jobs.enqueue({
    eventId: event.id,
    gameId: event.aggregateId,
    houseId: event.houseId,
    engineVersion: options.engineVersion,
    now: options.now,
  });
  return outcome === 'enqueued' ? 'processed' : 'duplicate';
}

export interface AnalysisMetrics {
  incrementFailure(): void;
}

export interface AnalysisWorkerDependencies {
  readonly jobs: AnalysisJobStore;
  readonly engineUrl: URL;
  readonly callbackUrl: URL;
  readonly secret: string;
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  readonly metrics: AnalysisMetrics;
}

/** [BM-044] Submit one leased job. The engine reports its result asynchronously. */
export async function dispatchAnalysisJob(
  dependencies: AnalysisWorkerDependencies,
): Promise<'idle' | 'submitted' | 'retried'> {
  const start = dependencies.now();
  const expired = await dependencies.jobs.expire(start, 3);
  for (let index = 0; index < expired; index += 1) dependencies.metrics.incrementFailure();
  const job = await dependencies.jobs.claim(start, new Date(start.getTime() + 120_000), 3);
  if (!job) return 'idle';
  try {
    const body = JSON.stringify({
      jobId: job.id,
      gameId: job.gameId,
      engineVersion: job.engineVersion,
      leaseToken: job.leaseToken,
      callbackUrl: dependencies.callbackUrl.toString(),
    });
    const response = await dependencies.fetch(dependencies.engineUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-analysis-signature': signAnalysisCallback(dependencies.secret, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 202) throw new Error('EngineRejectedRequest');
    return 'submitted';
  } catch (error) {
    dependencies.metrics.incrementFailure();
    await dependencies.jobs.fail(
      job.id,
      job.leaseToken,
      dependencies.now(),
      3,
      error instanceof Error ? error.name : 'EngineUnavailable',
    );
    return 'retried';
  }
}
