import { describe, expect, it } from 'vitest';
import { realtimeTokenHidesRootKey, realtimeTokenResponseSchema } from './realtime-token';

const rootKey = 'realtime-test-server-key';
const valid = {
  token: 'a'.repeat(32),
  expiresAt: '2026-09-04T14:15:00.000Z',
  clientId: '01941f29-7c00-7000-8000-000000000101',
  publicKey: 'realtime-test-public-key',
  channels: {
    night: 'n'.repeat(22),
    games: [
      {
        gameId: '01941f29-7c00-7000-8000-000000000801',
        channel: 'g'.repeat(22),
      },
    ],
  },
  presence: {
    clientId: '01941f29-7c00-7000-8000-000000000101',
    displayName: 'Ada',
    signature: 'presence-signature',
  },
};

describe('Realtime token contract', () => {
  it('[BM-037] accepts the client token shape and rejects extra fields', () => {
    expect(realtimeTokenResponseSchema.parse(valid)).toEqual(valid);
    expect(realtimeTokenResponseSchema.safeParse({ ...valid, serverKey: rootKey }).success).toBe(
      false,
    );
    expect(realtimeTokenResponseSchema.safeParse({ ...valid, token: 'short' }).success).toBe(false);
    expect(
      realtimeTokenResponseSchema.safeParse({
        ...valid,
        channels: { ...valid.channels, night: '01941f29-7c00-7000-8000-000000000901' },
      }).success,
    ).toBe(false);
  });

  it('[BM-037] treats the provider root key as absent from any client payload', () => {
    expect(realtimeTokenHidesRootKey(valid, rootKey)).toBe(true);
    expect(realtimeTokenHidesRootKey({ ...valid, publicKey: rootKey }, rootKey)).toBe(false);
    expect(realtimeTokenHidesRootKey({ nested: { serverKey: 'x' } }, rootKey)).toBe(false);
  });
});
