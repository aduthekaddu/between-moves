import { verifyAnalysisCallback } from '@between-moves/adapters';
import { PgAnalysisJobRepository } from '@between-moves/db';
import {
  createAnalysisMetricStubs,
  createStructuredLogger,
  type StructuredLogger,
} from '@between-moves/observability';
import { z } from 'zod';
import { getConfig } from '../config';
import { getDatabase } from './database';

const uuid = z.uuid();
const swing = z
  .object({
    ply: z.number().int().nonnegative(),
    centipawnsBefore: z.number().int().min(-100_000).max(100_000),
    centipawnsAfter: z.number().int().min(-100_000).max(100_000),
  })
  .strict();
const callback = z.discriminatedUnion('status', [
  z
    .object({
      jobId: uuid,
      leaseToken: uuid,
      status: z.literal('completed'),
      result: z.object({ swings: z.array(swing).max(128) }).strict(),
    })
    .strict(),
  z.object({ jobId: uuid, leaseToken: uuid, status: z.literal('failed') }).strict(),
]);
const metrics = createAnalysisMetricStubs();
const MAX_BODY_BYTES = 64 * 1024;

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export interface AnalysisCallbackDependencies {
  readonly secret: string;
  readonly jobs: Pick<PgAnalysisJobRepository, 'complete' | 'fail'>;
  readonly now: () => Date;
  readonly metrics?: ReturnType<typeof createAnalysisMetricStubs>;
  readonly logger?: Pick<StructuredLogger, 'log'>;
}

function productionDependencies(): AnalysisCallbackDependencies {
  return {
    secret: getConfig().analysisWorkerSecret,
    jobs: new PgAnalysisJobRepository(getDatabase().pool),
    now: () => new Date(),
    metrics,
    logger: createStructuredLogger({
      clock: { now: () => new Date() },
      sink: (line) => console.log(line),
    }),
  };
}

/** [BM-044] Signed, lease-fenced result callback. A duplicate success is harmless. */
export async function handleAnalysisCallback(
  request: Request,
  dependencies: AnalysisCallbackDependencies = productionDependencies(),
): Promise<Response> {
  const body = await readBody(request);
  if (body === null) return new Response(null, { status: 413 });
  const signature = request.headers.get('x-analysis-signature');
  if (!signature || !verifyAnalysisCallback(dependencies.secret, body, signature)) {
    return new Response(null, { status: 401 });
  }
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    return new Response(null, { status: 422 });
  }
  const parsed = callback.safeParse(value);
  if (!parsed.success) return new Response(null, { status: 422 });
  const now = dependencies.now();
  if (parsed.data.status === 'completed') {
    const completion = await dependencies.jobs.complete(
      parsed.data.jobId,
      parsed.data.leaseToken,
      parsed.data.result,
      now,
    );
    if (completion.outcome === 'processed' && completion.durationMs !== null) {
      dependencies.metrics?.observeDuration(completion.durationMs);
      dependencies.logger?.log({
        level: 'info',
        requestId: 'analysis-callback',
        actorId: 'anonymous',
        houseId: null,
        gameId: null,
        commandId: null,
        event: 'analysis.job-completed',
        outcome: 'success',
        durationMs: completion.durationMs,
        data: dependencies.metrics?.snapshot(),
      });
    }
    return new Response(null, { status: completion.outcome === 'stale' ? 409 : 204 });
  }
  const outcome = await dependencies.jobs.fail(
    parsed.data.jobId,
    parsed.data.leaseToken,
    now,
    3,
    'Engine reported failure',
  );
  if (outcome === 'processed') {
    dependencies.metrics?.incrementFailure();
    dependencies.logger?.log({
      level: 'warn',
      requestId: 'analysis-callback',
      actorId: 'anonymous',
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'analysis.job-failed',
      outcome: 'error',
      durationMs: 0,
      data: dependencies.metrics?.snapshot(),
    });
  }
  return new Response(null, { status: outcome === 'stale' ? 409 : 204 });
}
