import { HmacRealtimeTokenIssuer, inspectRealtimeCapabilityToken } from '@between-moves/adapters';
import { createRealtimeMetricStubs } from '@between-moves/observability';
import { AuthenticationRequiredError, type GamePosition } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createGameRealtimeStreamHandler,
  createGameRealtimeTokenHandler,
  type GameRealtimeDependencies,
} from './game-realtime-handler';
import { RealtimeNightFanout } from './realtime-fanout';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const otherHouseId = '01941f29-7c00-7000-8000-000000000602';
const gameId = '01941f29-7c00-7000-8000-000000000942';
const otherGameId = '01941f29-7c00-7000-8000-000000000943';
const userId = '01941f29-7c00-7000-8000-000000000615';
const now = new Date('2026-09-25T12:00:00.000Z');
const serverKey = 'game-realtime-test-server-key';

const position: GamePosition = {
  gameId,
  mode: 'live',
  state: 'active',
  currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  white: { membershipId: 'white-seat', name: 'Ada' },
  black: { membershipId: 'black-seat', name: 'Bea' },
  viewerColor: null,
  canMove: false,
  moveDueAt: null,
  liveClock: { whiteMs: 300_000, blackMs: 300_000, turnStartedAt: now },
  result: null,
  inCheck: false,
  moves: [],
  pendingDrawOffer: null,
};

function setup(): GameRealtimeDependencies {
  const issuer = new HmacRealtimeTokenIssuer({
    appId: 'game-realtime-test',
    serverKey,
    publicKey: 'game-realtime-public-key',
  });
  return {
    expectedOrigin: 'https://app.example.test',
    serverKey,
    requireViewer: vi.fn(async () => ({
      kind: 'authenticated' as const,
      userId,
      displayName: 'Mira',
      imageUrl: null,
    })),
    readPosition: vi.fn(async (_request, requestedHouse, requestedGame) =>
      requestedHouse === houseId && requestedGame === gameId ? position : null,
    ),
    limitToken: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    issueToken: (input) => issuer.issueGame(input),
    fanout: new RealtimeNightFanout(),
    metrics: createRealtimeMetricStubs(),
    clock: { now: () => now },
  };
}

function tokenRequest() {
  return new Request(
    `https://app.example.test/api/houses/${houseId}/games/${gameId}/realtime-token`,
    {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
    },
  );
}

function streamRequest(token: string) {
  return new Request(
    `https://app.example.test/api/houses/${houseId}/games/${gameId}/live?token=${encodeURIComponent(token)}`,
  );
}

describe('BM-043 Game subscriptions', () => {
  it('rejects invalid token requests before issuing a capability', async () => {
    const deps = setup();
    const handler = createGameRealtimeTokenHandler(deps);
    const wrongOrigin = new Request(tokenRequest(), {
      headers: { origin: 'https://other.example.test' },
    });
    expect((await handler(wrongOrigin, houseId, gameId)).status).toBe(403);
    expect((await handler(tokenRequest(), 'bad-house', gameId)).status).toBe(404);

    vi.mocked(deps.requireViewer).mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await handler(tokenRequest(), houseId, gameId)).status).toBe(401);
    vi.mocked(deps.limitToken).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 12 });
    const limited = await handler(tokenRequest(), houseId, gameId);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('12');
    vi.mocked(deps.readPosition).mockResolvedValueOnce({ ...position, mode: 'correspondence' });
    expect((await handler(tokenRequest(), houseId, gameId)).status).toBe(404);
    expect(deps.metrics.snapshot().realtime_token_issue_total).toBe(0);
  });

  it('issues a subscribe-only token to a non-seated House Member and streams a Game event', async () => {
    const deps = setup();
    const response = await createGameRealtimeTokenHandler(deps)(tokenRequest(), houseId, gameId);
    expect(response.status).toBe(200);
    const issued = (await response.json()) as { token: string; channel: string };
    const capability = inspectRealtimeCapabilityToken(issued.token, serverKey, now).capability;
    expect(capability).toEqual({ [issued.channel]: ['subscribe'] });
    expect(deps.metrics.snapshot().realtime_token_issue_total).toBe(1);

    const streamResponse = await createGameRealtimeStreamHandler(deps)(
      streamRequest(issued.token),
      houseId,
      gameId,
    );
    expect(streamResponse.status).toBe(200);
    const reader = streamResponse.body!.getReader();
    await reader.read(); // attached
    const nextEvent = reader.read();
    const envelope = {
      id: '01941f29-7c00-7000-8000-000000000950',
      channel: issued.channel,
      name: 'game.move-accepted',
      sequence: '1',
      data: { houseId, aggregateId: gameId, san: 'e4' },
      occurredAt: now.toISOString(),
    };
    deps.fanout.publish(null, envelope);
    expect(new TextDecoder().decode((await nextEvent).value)).toContain('"san":"e4"');
    await reader.cancel();
  });

  it('denies cross-House reads and tokens for another Game or viewer', async () => {
    const deps = setup();
    const issued = deps.issueToken({
      houseId,
      gameId,
      clientId: userId,
      displayName: 'Mira',
      issuedAt: now,
    });
    expect(
      (await createGameRealtimeTokenHandler(deps)(tokenRequest(), otherHouseId, gameId)).status,
    ).toBe(404);
    expect(
      (
        await createGameRealtimeStreamHandler(deps)(
          streamRequest(issued.token),
          otherHouseId,
          gameId,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await createGameRealtimeStreamHandler(deps)(
          streamRequest(issued.token),
          houseId,
          otherGameId,
        )
      ).status,
    ).toBe(404);
    const wrongScope = deps.issueToken({
      houseId,
      gameId: otherGameId,
      clientId: userId,
      displayName: 'Mira',
      issuedAt: now,
    });
    expect(
      (
        await createGameRealtimeStreamHandler(deps)(
          streamRequest(wrongScope.token),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(403);
    const wrongViewer = deps.issueToken({
      houseId,
      gameId,
      clientId: '01941f29-7c00-7000-8000-000000000611',
      displayName: 'Ada',
      issuedAt: now,
    });
    expect(
      (
        await createGameRealtimeStreamHandler(deps)(
          streamRequest(wrongViewer.token),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(403);
  });

  it('rejects an absent, expired, or forged stream capability', async () => {
    const deps = setup();
    const handler = createGameRealtimeStreamHandler(deps);
    expect(
      (
        await handler(
          new Request(`https://app.example.test/api/houses/${houseId}/games/${gameId}/live`),
          houseId,
          gameId,
        )
      ).status,
    ).toBe(403);
    expect((await handler(streamRequest('forged'), houseId, gameId)).status).toBe(403);
    const expired = deps.issueToken({
      houseId,
      gameId,
      clientId: userId,
      displayName: 'Mira',
      issuedAt: new Date(now.getTime() - 60 * 60_000),
    });
    expect((await handler(streamRequest(expired.token), houseId, gameId)).status).toBe(403);
    vi.mocked(deps.requireViewer).mockRejectedValueOnce(new AuthenticationRequiredError());
    expect((await handler(streamRequest(expired.token), houseId, gameId)).status).toBe(401);
  });
});
