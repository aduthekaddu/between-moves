import { verifyAnalysisCallback } from '@between-moves/adapters';
import { describe, expect, it, vi } from 'vitest';
import {
  dispatchAnalysisJob,
  enqueueAnalysisRequest,
} from '../../../worker/src/modules/stories/analysis';

const job = {
  id: '01941f29-7c00-7000-8000-000000000501',
  gameId: '01941f29-7c00-7000-8000-000000000503',
  engineVersion: 'stockfish-17',
  attempts: 1,
  leaseToken: '01941f29-7c00-7000-8000-000000000502',
};

function setup(fetcher: typeof fetch) {
  const jobs = {
    expire: vi.fn().mockResolvedValue(0),
    claim: vi.fn().mockResolvedValue(job),
    fail: vi.fn().mockResolvedValue('processed'),
  };
  const metrics = { incrementFailure: vi.fn() };
  const dependencies = {
    jobs,
    metrics,
    fetch: fetcher,
    secret: 'engine-secret',
    engineUrl: new URL('https://engine.example.test/analyze'),
    callbackUrl: new URL('https://app.example.test/api/internal/analysis/callback'),
    now: () => new Date('2026-09-25T10:00:00Z'),
  };
  return { jobs, metrics, dependencies };
}

describe('BM-044 analysis worker request/response contract', () => {
  it('honors the analysis disable flag before enqueueing', async () => {
    const enqueue = vi.fn().mockResolvedValue('enqueued');
    const event = {
      id: job.id,
      aggregateId: job.gameId,
      houseId: '01941f29-7c00-7000-8000-000000000504',
    };
    const options = { enabled: false, engineVersion: 'v1', now: new Date() };
    expect(await enqueueAnalysisRequest(event, { enqueue }, options)).toBe('processed');
    expect(enqueue).not.toHaveBeenCalled();
    expect(await enqueueAnalysisRequest(event, { enqueue }, { ...options, enabled: true })).toBe(
      'processed',
    );
    expect(enqueue).toHaveBeenCalledWith({
      eventId: event.id,
      gameId: event.aggregateId,
      houseId: event.houseId,
      engineVersion: 'v1',
      now: options.now,
    });
  });

  it('leases a game reference and submits a signed engine request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const { jobs, dependencies } = setup(fetcher);
    expect(await dispatchAnalysisJob(dependencies)).toBe('submitted');
    expect(jobs.claim).toHaveBeenCalledWith(
      dependencies.now(),
      new Date('2026-09-25T10:02:00Z'),
      3,
    );
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://engine.example.test/analyze');
    const body = String(options.body);
    expect(JSON.parse(body)).toEqual({
      jobId: job.id,
      gameId: job.gameId,
      engineVersion: job.engineVersion,
      leaseToken: job.leaseToken,
      callbackUrl: dependencies.callbackUrl.toString(),
    });
    expect(
      verifyAnalysisCallback(
        dependencies.secret,
        body,
        new Headers(options.headers).get('x-analysis-signature')!,
      ),
    ).toBe(true);
    expect(body).not.toMatch(/note|private|fen/i);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('retries an engine outage independently of the completed game', async () => {
    const { jobs, metrics, dependencies } = setup(
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    expect(await dispatchAnalysisJob(dependencies)).toBe('retried');
    expect(jobs.fail).toHaveBeenCalledWith(job.id, job.leaseToken, dependencies.now(), 3, 'Error');
    expect(metrics.incrementFailure).toHaveBeenCalledOnce();
  });

  it('counts jobs exhausted by expired leases', async () => {
    const { jobs, metrics, dependencies } = setup(vi.fn());
    jobs.expire.mockResolvedValue(2);
    jobs.claim.mockResolvedValue(null);
    expect(await dispatchAnalysisJob(dependencies)).toBe('idle');
    expect(metrics.incrementFailure).toHaveBeenCalledTimes(2);
  });
});
