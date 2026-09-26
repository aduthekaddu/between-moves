import { signAnalysisCallback } from '@between-moves/adapters';
import { describe, expect, it, vi } from 'vitest';
import { handleAnalysisCallback } from './analysis-callback-handler';

const jobId = '01941f29-7c00-7000-8000-000000000501';
const leaseToken = '01941f29-7c00-7000-8000-000000000502';
const secret = 'analysis-contract-secret';
const result = { swings: [{ ply: 11, centipawnsBefore: 20, centipawnsAfter: -300 }] };

function request(payload: unknown, signingKey = secret): Request {
  const body = JSON.stringify(payload);
  return new Request('https://app.example.test/api/internal/analysis/callback', {
    method: 'POST',
    body,
    headers: { 'x-analysis-signature': signAnalysisCallback(signingKey, body) },
  });
}

describe('BM-044 analysis result callback contract', () => {
  it('verifies the exact body and processes a duplicated success once', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'processed', durationMs: 12_000 })
      .mockResolvedValueOnce({ outcome: 'duplicate', durationMs: null });
    const fail = vi.fn();
    const observeDuration = vi.fn();
    const dependencies = {
      secret,
      jobs: { complete, fail },
      now: () => new Date('2026-09-25T10:00:00Z'),
      metrics: { observeDuration, incrementFailure: vi.fn(), snapshot: vi.fn() },
    };
    const payload = { jobId, leaseToken, status: 'completed', result };
    expect((await handleAnalysisCallback(request(payload), dependencies)).status).toBe(204);
    expect((await handleAnalysisCallback(request(payload), dependencies)).status).toBe(204);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(observeDuration).toHaveBeenCalledOnce();
    expect(observeDuration).toHaveBeenCalledWith(12_000);
    expect(complete).toHaveBeenCalledWith(jobId, leaseToken, result, dependencies.now());
    expect(fail).not.toHaveBeenCalled();
    expect((await handleAnalysisCallback(request(payload, 'wrong-key'), dependencies)).status).toBe(
      401,
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('rejects stale leases and unstructured or private result data', async () => {
    const complete = vi.fn().mockResolvedValue({ outcome: 'stale', durationMs: null });
    const dependencies = { secret, jobs: { complete, fail: vi.fn() }, now: () => new Date() };
    expect(
      (
        await handleAnalysisCallback(
          request({ jobId, leaseToken, status: 'completed', result }),
          dependencies,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handleAnalysisCallback(
          request({
            jobId,
            leaseToken,
            status: 'completed',
            result: { swings: [], note: 'private' },
          }),
          dependencies,
        )
      ).status,
    ).toBe(422);
  });

  it('acknowledges duplicate failure callbacks and counts one failure', async () => {
    const fail = vi.fn().mockResolvedValueOnce('processed').mockResolvedValueOnce('duplicate');
    const incrementFailure = vi.fn();
    const dependencies = {
      secret,
      jobs: { complete: vi.fn(), fail },
      now: () => new Date('2026-09-25T10:00:00Z'),
      metrics: { incrementFailure, observeDuration: vi.fn(), snapshot: vi.fn() },
    };
    const payload = { jobId, leaseToken, status: 'failed' };
    expect((await handleAnalysisCallback(request(payload), dependencies)).status).toBe(204);
    expect((await handleAnalysisCallback(request(payload), dependencies)).status).toBe(204);
    expect(incrementFailure).toHaveBeenCalledOnce();
  });

  it('rejects a streamed oversized body before parsing or writing', async () => {
    const complete = vi.fn();
    const chunk = new Uint8Array(32 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const input = new Request('https://app.example.test/api/internal/analysis/callback', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    const dependencies = { secret, jobs: { complete, fail: vi.fn() }, now: () => new Date() };
    expect((await handleAnalysisCallback(input, dependencies)).status).toBe(413);
    expect(complete).not.toHaveBeenCalled();
  });
});
