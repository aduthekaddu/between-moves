import { describe, expect, it } from 'vitest';
import { parseGameSeatReplay, type GameSeatReplayRow } from './game-seat-row-parser';

const houseId = '01941f29-7c00-7000-8000-000000000201';

function row(overrides: Partial<GameSeatReplayRow> = {}): GameSeatReplayRow {
  return {
    game_id: '01941f29-7c00-7000-8000-000000000301',
    open_seat_id: '01941f29-7c00-7000-8000-000000000302',
    season_id: '01941f29-7c00-7000-8000-000000000401',
    creator_membership_id: '01941f29-7c00-7000-8000-000000000501',
    intended_membership_id: null,
    offered_color: 'white',
    creator_color: 'black',
    expires_at: new Date('2026-09-09T08:00:00.000Z'),
    creation_payload_digest: 'a'.repeat(64),
    expected_payload_digest: 'a'.repeat(64),
    ...overrides,
  };
}

describe('BM-022 Game seat row parser', () => {
  it('returns the original idempotent creation result', () => {
    expect(parseGameSeatReplay(row(), houseId)).toMatchObject({
      houseId,
      offeredColor: 'white',
      creatorColor: 'black',
      createdNow: false,
    });
  });

  it('rejects an idempotency key reused for another payload', () => {
    expect(() =>
      parseGameSeatReplay(row({ expected_payload_digest: 'b'.repeat(64) }), houseId),
    ).toThrow(expect.objectContaining({ code: 'idempotency_conflict' }));
  });
});
