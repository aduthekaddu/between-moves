import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { allocateGameCompletionSequence } from './game-completion-sequence';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000000691';

describe('BM-034 Game completion sequence allocator', () => {
  it('returns the next positive sequence allocated by the Season row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: '7' }], rowCount: 1 });
    const client = { query } as unknown as PoolClient;

    await expect(allocateGameCompletionSequence(client, houseId, seasonId)).resolves.toBe(7n);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('game_completion_sequence+1'), [
      seasonId,
      houseId,
    ]);
  });

  it.each([
    { rows: [], label: 'a missing sequence' },
    { rows: [{ value: '0' }], label: 'a zero sequence' },
    { rows: [{ value: 'not-a-number' }], label: 'a malformed sequence' },
  ])('rejects $label', async ({ rows }) => {
    const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
    const client = { query } as unknown as PoolClient;

    await expect(allocateGameCompletionSequence(client, houseId, seasonId)).rejects.toThrow(
      'Game Season completion sequence is unavailable',
    );
  });
});
