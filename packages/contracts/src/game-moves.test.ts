import { describe, expect, it } from 'vitest';
import { submitMoveBodySchema } from './game-moves';

describe('BM-024 submit Move wire contract', () => {
  it('[BM-024] [DR-SEC-03] accepts only a bounded canonical Move proposal and UUIDv7 command', () => {
    const valid = {
      expectedPly: 0,
      clientCommandId: '01941f29-7c00-7000-8000-000000000401',
      move: { from: 'e2', to: 'e4' },
    };

    expect(submitMoveBodySchema.safeParse(valid).success).toBe(true);
    expect(submitMoveBodySchema.safeParse({ ...valid, expectedPly: -1 }).success).toBe(false);
    expect(
      submitMoveBodySchema.safeParse({
        ...valid,
        clientCommandId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(false);
    expect(
      submitMoveBodySchema.safeParse({ ...valid, move: { from: 'e2', to: 'e4', san: 'e4' } })
        .success,
    ).toBe(false);
  });
});
