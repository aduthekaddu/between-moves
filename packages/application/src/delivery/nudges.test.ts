import type { DueNudge, NudgeMetrics, NudgeRepository, NudgeStage } from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createNudgeDispatcher } from './nudges';

const NOW = new Date('2026-09-15T12:00:00.000Z');

function due(stage: NudgeStage): DueNudge {
  return {
    gameId: '01941f29-7c00-7000-8000-000000000101',
    houseId: '01941f29-7c00-7000-8000-000000000102',
    ply: 7,
    recipientMembershipId: '01941f29-7c00-7000-8000-000000000103',
    stage,
    moveDueAt: new Date(
      NOW.getTime() + (stage === 'advance' ? 12 * 60 * 60 * 1_000 : -60 * 60 * 1_000),
    ),
  };
}

function harness(candidates: readonly DueNudge[]) {
  const repository: NudgeRepository = {
    findDue: vi.fn(async () => candidates),
    enqueue: vi.fn(async () => true),
  };
  const metrics: NudgeMetrics = {
    incrementNudgeEnqueue: vi.fn(),
    incrementNudgeSend: vi.fn(),
  };
  let suffix = 200;
  const dispatcher = createNudgeDispatcher({
    clock: new FakeClock(NOW),
    generateId: () => `01941f29-7c00-7000-8000-${String((suffix += 1)).padStart(12, '0')}`,
    repository,
    metrics,
    advanceWindowMs: 24 * 60 * 60 * 1_000,
    batchSize: 25,
  });
  return { dispatcher, metrics, repository };
}

describe('Nudge dispatcher', () => {
  it.each(['advance', 'overdue'] as const)(
    '[BM-029] [DR-CORR-04] enqueues one %s Nudge from the fake-clock deadline scan',
    async (stage) => {
      const candidate = due(stage);
      const { dispatcher, metrics, repository } = harness([candidate]);

      await expect(dispatcher.dispatch()).resolves.toEqual({
        scanned: 1,
        enqueued: 1,
        duplicate: 0,
      });
      expect(repository.findDue).toHaveBeenCalledWith({
        now: NOW,
        advanceCutoff: new Date('2026-09-16T12:00:00.000Z'),
        limit: 25,
      });
      expect(repository.enqueue).toHaveBeenCalledWith(
        candidate,
        expect.objectContaining({
          id: expect.any(String),
          topic: 'nudge.due',
          aggregateId: candidate.gameId,
          houseId: candidate.houseId,
          payload: {
            recipientMembershipId: candidate.recipientMembershipId,
            ply: candidate.ply,
            stage,
          },
          availableAt: NOW,
          occurredAt: NOW,
        }),
      );
      expect(metrics.incrementNudgeEnqueue).toHaveBeenCalledWith(stage, 'enqueued');
    },
  );

  it('[BM-029] [DR-CORR-04] reports a natural-key collision as an idempotent duplicate', async () => {
    const candidate = due('advance');
    const { dispatcher, metrics, repository } = harness([candidate]);
    vi.mocked(repository.enqueue).mockResolvedValue(false);

    await expect(dispatcher.dispatch()).resolves.toEqual({ scanned: 1, enqueued: 0, duplicate: 1 });
    expect(metrics.incrementNudgeEnqueue).toHaveBeenCalledWith('advance', 'duplicate');
  });
});
