import { realtimeChannelOperations } from '@between-moves/domain';
import { describe, expect, it } from 'vitest';
import { HmacRealtimeTokenIssuer, inspectRealtimeCapabilityToken } from './realtime-token';

const serverKey = 'realtime-test-server-key';
const publicKey = 'realtime-test-public-key';
const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const otherNightId = '01941f29-7c00-7000-8000-000000000902';
const gameId = '01941f29-7c00-7000-8000-000000000801';
const otherGameId = '01941f29-7c00-7000-8000-000000000802';
const issuedAt = new Date('2026-09-04T14:00:00.000Z');

function issuer() {
  return new HmacRealtimeTokenIssuer({
    appId: 'realtime-test-app',
    serverKey,
    publicKey,
    random: () => Buffer.alloc(16, 7),
  });
}

describe('HmacRealtimeTokenIssuer', () => {
  it('[BM-037] mints a token scoped to opaque Night and Game channels', () => {
    const issued = issuer().issue({
      houseId,
      nightId,
      gameIds: [gameId],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    const payload = inspectRealtimeCapabilityToken(issued.token, serverKey, issuedAt);

    expect(issued.publicKey).toBe(publicKey);
    expect(issued.channels.night).toHaveLength(22);
    expect(issued.channels.night).not.toContain(nightId);
    expect(issued.channels.night).not.toContain(houseId);
    expect(issued.channels.games).toEqual([{ gameId, channel: expect.any(String) }]);
    expect(issued.channels.games[0]?.channel).not.toContain(gameId);
    expect(issued.channels.games[0]?.channel).not.toContain(houseId);
    expect(payload.capability).toEqual({
      [issued.channels.night]: realtimeChannelOperations('night'),
      [issued.channels.games[0]?.channel ?? 'missing']: realtimeChannelOperations('game'),
    });
    expect(Object.values(payload.capability).flat()).not.toContain('publish');
    expect(JSON.stringify({ issued, payload })).not.toContain(serverKey);
  });

  it('[BM-037] does not grant another Night or Game channel', () => {
    const tokens = issuer();
    const scoped = tokens.issue({
      houseId,
      nightId,
      gameIds: [gameId],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    const other = tokens.issue({
      houseId,
      nightId: otherNightId,
      gameIds: [otherGameId],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    const payload = inspectRealtimeCapabilityToken(scoped.token, serverKey, issuedAt);

    expect(scoped.channels.night).not.toBe(other.channels.night);
    expect(payload.capability[other.channels.night]).toBeUndefined();
    expect(payload.capability[other.channels.games[0]?.channel ?? 'missing']).toBeUndefined();
  });

  it('[BM-037] signs presence display data without granting permissions', () => {
    const issued = issuer().issue({
      houseId,
      nightId,
      gameIds: [],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    const payload = inspectRealtimeCapabilityToken(issued.token, serverKey, issuedAt);

    expect(issued.presence).toEqual({
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      signature: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    });
    expect(payload.capability[issued.channels.night]).toEqual(['presence', 'subscribe']);
    expect(issued.presence.signature).not.toBe(issued.token);
    const otherName = issuer().issue({
      houseId,
      nightId,
      gameIds: [],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Bea',
      issuedAt,
    });
    expect(otherName.presence.signature).not.toBe(issued.presence.signature);
    const otherNight = issuer().issue({
      houseId,
      nightId: otherNightId,
      gameIds: [],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    expect(otherNight.presence.signature).not.toBe(issued.presence.signature);
  });

  it('[BM-037] rejects a forged token MAC', () => {
    const issued = issuer().issue({
      houseId,
      nightId,
      gameIds: [],
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      issuedAt,
    });
    const [body] = issued.token.split('.');

    expect(() => inspectRealtimeCapabilityToken(`${body}.AAAA`, serverKey, issuedAt)).toThrow(
      /Realtime token is invalid/,
    );
    expect(() =>
      inspectRealtimeCapabilityToken(issued.token, serverKey, new Date(issued.expiresAt.getTime())),
    ).toThrow(/Realtime token is invalid/);
  });
});
