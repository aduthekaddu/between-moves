import { describe, expect, it } from 'vitest';
import { REALTIME_TOKEN_TTL_MS, realtimeChannelOperations } from './realtime-token';

describe('Realtime token policy', () => {
  it('[BM-037] keeps tokens short-lived', () => {
    expect(REALTIME_TOKEN_TTL_MS).toBe(15 * 60 * 1_000);
  });

  it('[BM-037] scopes presence to the Night channel and never grants publish', () => {
    expect(realtimeChannelOperations('night')).toEqual(['presence', 'subscribe']);
    expect(realtimeChannelOperations('game')).toEqual(['subscribe']);
    expect(realtimeChannelOperations('night')).not.toContain('publish');
    expect(realtimeChannelOperations('game')).not.toContain('publish');
  });
});
