import { describe, expect, it } from 'vitest';
import { createGameSeatBodySchema } from './game-seats';

describe('BM-022 Game seat command contract', () => {
  it('[BM-022] accepts correspondence Open seats and direct challenges', () => {
    expect(
      createGameSeatBodySchema.safeParse({
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
        offeredColor: 'any',
      }).success,
    ).toBe(true);
    expect(
      createGameSeatBodySchema.safeParse({
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
        offeredColor: 'white',
        intendedMembershipId: '01941f29-7c00-7000-8000-000000000202',
      }).success,
    ).toBe(true);
  });

  it('[BM-022] rejects live, malformed clock, color, and target shapes', () => {
    for (const body of [
      { mode: 'live', clockPolicy: { kind: 'live', initialMs: 300_000, incrementMs: 0 } },
      {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 0 },
        offeredColor: 'white',
      },
      {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 24, initialMs: 300_000 },
        offeredColor: 'white',
      },
      {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
        offeredColor: 'green',
      },
      {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 24 },
        offeredColor: 'black',
        intendedMembershipId: 'not-a-membership',
      },
    ]) {
      expect(createGameSeatBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
