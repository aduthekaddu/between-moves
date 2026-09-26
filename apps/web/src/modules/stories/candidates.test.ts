import { describe, expect, it, vi } from 'vitest';
import { generatePuzzleCandidates, PUZZLE_SWING_THRESHOLD_CP } from './candidates';

const jobId = '01941f29-7c00-7000-8000-000000000501';
const houseId = '01941f29-7c00-7000-8000-000000000502';
const now = new Date('2026-09-26T10:00:00Z');

describe('BM-045 puzzle candidate generation', () => {
  it('creates only swings at or above the threshold and counts new rows', async () => {
    const writer = {
      create: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const created = await generatePuzzleCandidates(
      jobId,
      houseId,
      [
        { ply: 1, centipawnsBefore: 0, centipawnsAfter: 199, bestLine: ['e2e4'] },
        {
          ply: 2,
          centipawnsBefore: 0,
          centipawnsAfter: -PUZZLE_SWING_THRESHOLD_CP,
          bestLine: ['e7e5'],
        },
        { ply: 3, centipawnsBefore: -100, centipawnsAfter: 150, bestLine: ['d2d4'] },
      ],
      now,
      writer,
    );
    expect(created).toBe(1);
    expect(writer.create).toHaveBeenCalledTimes(2);
    expect(writer.create).toHaveBeenCalledWith({
      jobId,
      houseId,
      sourcePly: 2,
      bestLine: ['e7e5'],
      evaluationSwingCp: 200,
      now,
    });
  });

  it('creates nothing for a game without a qualifying swing', async () => {
    const writer = { create: vi.fn() };
    expect(
      await generatePuzzleCandidates(
        jobId,
        houseId,
        [{ ply: 1, centipawnsBefore: 0, centipawnsAfter: 199, bestLine: ['e2e4'] }],
        now,
        writer,
      ),
    ).toBe(0);
    expect(writer.create).not.toHaveBeenCalled();
  });
});
