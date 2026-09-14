import { describe, expect, it } from 'vitest';
import { drawGameBodySchema, resignGameBodySchema } from './game-completion';

const clientCommandId = '01941f29-7c00-7000-8000-000000000401';

describe('BM-028 Game completion contracts', () => {
  it('accepts only UUIDv7 resignation command IDs', () => {
    expect(resignGameBodySchema.safeParse({ clientCommandId }).success).toBe(true);
    expect(
      resignGameBodySchema.safeParse({
        clientCommandId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(false);
  });

  it('accepts only offer and accept draw actions', () => {
    expect(drawGameBodySchema.safeParse({ action: 'offer', clientCommandId }).success).toBe(true);
    expect(drawGameBodySchema.safeParse({ action: 'accept', clientCommandId }).success).toBe(true);
    expect(drawGameBodySchema.safeParse({ action: 'decline', clientCommandId }).success).toBe(
      false,
    );
  });
});
