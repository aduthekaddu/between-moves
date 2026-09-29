import { signRealtimePublish } from '@between-moves/adapters';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeNightFanout } from './realtime-fanout';
import { handleRealtimePublish } from './realtime-publish-handler';

const serverKey = 'realtime-test-server-key';
const envelope = {
  id: '01941f29-7c00-7000-8000-000000000501',
  channel: 'n'.repeat(22),
  name: 'night.started',
  sequence: '1',
  data: {
    houseId: '01941f29-7c00-7000-8000-000000000201',
    aggregateId: '01941f29-7c00-7000-8000-000000000901',
    at: '2026-09-04T14:00:00.000Z',
  },
  occurredAt: '2026-09-04T14:00:00.000Z',
};

describe('Realtime publish HTTP seam', () => {
  it('[BM-038] rejects a missing or invalid signature and fans out a Night event', async () => {
    const body = JSON.stringify(envelope);
    const fanout = new RealtimeNightFanout();
    const listener = vi.fn();
    fanout.subscribe(envelope.data.aggregateId, listener);
    const dependencies = {
      serverKey,
      database: { query: vi.fn() } as unknown as Pool,
      fanout,
    };

    const unsigned = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        body,
      }),
      dependencies,
    );
    expect(unsigned.status).toBe(401);

    const forged = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish('other-key', body) },
        body,
      }),
      dependencies,
    );
    expect(forged.status).toBe(401);

    const published = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish(serverKey, body) },
        body,
      }),
      dependencies,
    );
    expect(published.status).toBe(204);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('[BM-040] fans House chat out onto the Night channel from payload.nightId', async () => {
    const chatEnvelope = {
      ...envelope,
      name: 'night.chat-posted',
      data: {
        houseId: envelope.data.houseId,
        aggregateId: '01941f29-7c00-7000-8000-000000000801',
        nightId: envelope.data.aggregateId,
        body: 'Hello from the rail',
        chatSequence: '1',
      },
    };
    const body = JSON.stringify(chatEnvelope);
    const fanout = new RealtimeNightFanout();
    const listener = vi.fn();
    fanout.subscribe(envelope.data.aggregateId, listener);
    const published = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish(serverKey, body) },
        body,
      }),
      {
        serverKey,
        database: { query: vi.fn() } as unknown as Pool,
        fanout,
      },
    );
    expect(published.status).toBe(204);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('[BM-043] fans out a Game Move even when the Game has no Night', async () => {
    const gameId = '01941f29-7c00-7000-8000-000000000942';
    const gameEnvelope = {
      ...envelope,
      name: 'game.move-accepted',
      data: { houseId: envelope.data.houseId, aggregateId: gameId, san: 'e4' },
    };
    const fanout = new RealtimeNightFanout();
    const listener = vi.fn();
    fanout.subscribeGame(gameEnvelope.channel, listener);
    const body = JSON.stringify(gameEnvelope);
    const response = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish(serverKey, body) },
        body,
      }),
      {
        serverKey,
        database: { query: vi.fn(async () => ({ rows: [{ night_id: null }] })) } as unknown as Pool,
        fanout,
      },
    );
    expect(response.status).toBe(204);
    expect(listener).toHaveBeenCalledWith(gameEnvelope);
  });

  it('[BM-028] fans a draw offer change out to the Game channel and its Night rail', async () => {
    const gameId = '01941f29-7c00-7000-8000-000000000943';
    const nightId = '01941f29-7c00-7000-8000-000000000944';
    const drawEnvelope = {
      ...envelope,
      name: 'game.draw-offer-changed',
      data: { houseId: envelope.data.houseId, aggregateId: gameId, change: 'declined' },
    };
    const fanout = new RealtimeNightFanout();
    const gameListener = vi.fn();
    const railListener = vi.fn();
    fanout.subscribeGame(drawEnvelope.channel, gameListener);
    fanout.subscribe(nightId, railListener);
    const body = JSON.stringify(drawEnvelope);
    const response = await handleRealtimePublish(
      new Request('https://app.example.test/api/internal/realtime/publish', {
        method: 'POST',
        headers: { 'x-realtime-signature': signRealtimePublish(serverKey, body) },
        body,
      }),
      {
        serverKey,
        database: {
          query: vi.fn(async () => ({ rows: [{ night_id: nightId }] })),
        } as unknown as Pool,
        fanout,
      },
    );
    expect(response.status).toBe(204);
    expect(gameListener).toHaveBeenCalledWith(drawEnvelope);
    expect(railListener).toHaveBeenCalledWith(drawEnvelope);
  });
});
