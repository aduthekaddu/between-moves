import {
  GAME_COMPLETED_TOPIC,
  GAME_MOVE_ACCEPTED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  NIGHT_STARTED_TOPIC,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  HmacRealtimeChannelResolver,
  HttpRealtimePublisher,
  MemoryRealtimePublisher,
  signRealtimePublish,
} from './realtime-publish';
import { opaqueRealtimeChannelId } from './realtime-token';

const serverKey = 'realtime-test-server-key';
const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const gameId = '01941f29-7c00-7000-8000-000000000801';
const eventId = '01941f29-7c00-7000-8000-000000000501';
const occurredAt = new Date('2026-09-04T14:00:00.000Z');

describe('Realtime publish adapter', () => {
  it('[BM-038] maps Game and Night events onto opaque channels', () => {
    const channels = new HmacRealtimeChannelResolver(serverKey);

    expect(
      channels.channelFor({
        id: eventId,
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        aggregateId: gameId,
        sequence: 1n,
        houseId,
        payload: {},
        attempts: 1,
        availableAt: occurredAt,
        occurredAt,
      }),
    ).toBe(opaqueRealtimeChannelId(serverKey, 'game', houseId, gameId));
    expect(
      channels.channelFor({
        id: eventId,
        topic: NIGHT_STARTED_TOPIC,
        aggregateId: nightId,
        sequence: 1n,
        houseId,
        payload: {},
        attempts: 1,
        availableAt: occurredAt,
        occurredAt,
      }),
    ).toBe(opaqueRealtimeChannelId(serverKey, 'night', houseId, nightId));
    expect(
      channels.channelFor({
        id: eventId,
        topic: GAME_COMPLETED_TOPIC,
        aggregateId: gameId,
        sequence: 2n,
        houseId: null,
        payload: {},
        attempts: 1,
        availableAt: occurredAt,
        occurredAt,
      }),
    ).toBeNull();
    expect(
      channels.channelFor({
        id: eventId,
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: '01941f29-7c00-7000-8000-000000000801',
        sequence: 1n,
        houseId,
        payload: { nightId },
        attempts: 1,
        availableAt: occurredAt,
        occurredAt,
      }),
    ).toBe(opaqueRealtimeChannelId(serverKey, 'night', houseId, nightId));
  });

  it('[BM-038] publishes once per event ID with a sequenced opaque envelope', async () => {
    const publisher = new MemoryRealtimePublisher();
    const channel = opaqueRealtimeChannelId(serverKey, 'game', houseId, gameId);
    const message = {
      eventId,
      channel,
      topic: GAME_MOVE_ACCEPTED_TOPIC,
      houseId,
      aggregateId: gameId,
      sequence: 2n,
      payload: { san: 'e5', ply: 2 },
      occurredAt,
    };

    await expect(publisher.publish(message)).resolves.toBe('published');
    await expect(publisher.publish(message)).resolves.toBe('duplicate');
    expect(publisher.envelopes).toEqual([
      {
        id: eventId,
        channel,
        name: GAME_MOVE_ACCEPTED_TOPIC,
        sequence: '2',
        data: { houseId, aggregateId: gameId, san: 'e5', ply: 2 },
        occurredAt: occurredAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(publisher.envelopes)).not.toContain(serverKey);
    expect(channel).not.toContain(gameId);
    expect(channel).not.toContain(houseId);
  });

  it('[BM-038] POSTs a signed envelope and treats HTTP 409 as a duplicate', async () => {
    const channel = opaqueRealtimeChannelId(serverKey, 'game', houseId, gameId);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      const signature = new Headers(init?.headers).get('x-realtime-signature');
      expect(signature).toBe(signRealtimePublish(serverKey, body));
      expect(body).not.toContain(serverKey);
      return new Response(null, { status: 409 });
    });
    const publisher = new HttpRealtimePublisher({
      url: 'https://app.example.test/api/internal/realtime/publish',
      serverKey,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      publisher.publish({
        eventId,
        channel,
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        houseId,
        aggregateId: gameId,
        sequence: 2n,
        payload: { san: 'e5' },
        occurredAt,
      }),
    ).resolves.toBe('duplicate');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
