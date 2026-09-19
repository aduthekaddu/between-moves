import { describe, expect, it } from 'vitest';
import {
  applyChatRealtimeEvent,
  applyChatRealtimeEventOrRepair,
  HOUSE_CHAT_RECENT_LIMIT,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  retainNewerHouseChat,
  validateHouseChatBody,
  type HouseChatSnapshot,
} from './chat';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const messageId = '01941f29-7c00-7000-8000-000000000801';
const nextMessageId = '01941f29-7c00-7000-8000-000000000802';
const createdAt = new Date('2026-09-18T14:00:00.000Z');

function snapshot(overrides: Partial<HouseChatSnapshot> = {}): HouseChatSnapshot {
  return {
    houseId,
    nightId,
    chatSequence: 1n,
    currentMembershipId: '01941f29-7c00-7000-8000-000000000621',
    canModerate: false,
    messages: [
      {
        id: messageId,
        membershipId: '01941f29-7c00-7000-8000-000000000623',
        authorDisplayName: 'Bea',
        body: 'Hello from the rail',
        sequence: 1n,
        createdAt,
      },
    ],
    ...overrides,
  };
}

describe('House chat domain', () => {
  it('[BM-040] rejects empty and over-length chat bodies', () => {
    expect(() => validateHouseChatBody('')).toThrow(/1–2000/);
    expect(() => validateHouseChatBody('a'.repeat(2_001))).toThrow(/1–2000/);
    expect(validateHouseChatBody('😀'.repeat(2_000))).toBe('😀'.repeat(2_000));
  });

  it('[BM-040] applies the next posted message and ignores a redelivered sequence', () => {
    const posted = {
      topic: NIGHT_CHAT_POSTED_TOPIC,
      aggregateId: nextMessageId,
      sequence: 1n,
      payload: {
        nightId,
        messageId: nextMessageId,
        membershipId: '01941f29-7c00-7000-8000-000000000621',
        authorDisplayName: 'Ada',
        body: 'Welcome in',
        createdAt: '2026-09-18T14:01:00.000Z',
        chatSequence: '2',
      },
    };

    const applied = applyChatRealtimeEvent(snapshot(), posted);
    expect(applied).toMatchObject({
      kind: 'applied',
      snapshot: {
        chatSequence: 2n,
        messages: [
          expect.objectContaining({ id: messageId }),
          expect.objectContaining({ id: nextMessageId, body: 'Welcome in' }),
        ],
      },
    });
    expect(applyChatRealtimeEvent(snapshot({ chatSequence: 2n }), posted)).toEqual({
      kind: 'ignored',
    });
  });

  it('[BM-040] signals a sequence gap so reconnect can repair from a durable read', () => {
    expect(
      applyChatRealtimeEvent(snapshot(), {
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: nextMessageId,
        sequence: 1n,
        payload: {
          nightId,
          messageId: nextMessageId,
          membershipId: '01941f29-7c00-7000-8000-000000000621',
          authorDisplayName: 'Ada',
          body: 'Skipped ahead',
          createdAt: '2026-09-18T14:02:00.000Z',
          chatSequence: '4',
        },
      }),
    ).toEqual({ kind: 'gap' });
  });

  it('[BM-040] removes a soft-deleted message from the rendered snapshot', () => {
    expect(
      applyChatRealtimeEvent(snapshot(), {
        topic: NIGHT_CHAT_DELETED_TOPIC,
        aggregateId: messageId,
        sequence: 2n,
        payload: { nightId, messageId, chatSequence: '2' },
      }),
    ).toEqual({
      kind: 'applied',
      snapshot: snapshot({ chatSequence: 2n, messages: [] }),
    });
  });

  it('[BM-040] ignores a published event that the durable reconnect already loaded', () => {
    const current = snapshot({ chatSequence: 2n });
    expect(
      applyChatRealtimeEvent(current, {
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: nextMessageId,
        sequence: 1n,
        payload: {
          nightId,
          messageId: nextMessageId,
          membershipId: '01941f29-7c00-7000-8000-000000000621',
          authorDisplayName: 'Ada',
          body: 'Already durable',
          createdAt: '2026-09-18T14:01:00.000Z',
          chatSequence: '2',
        },
      }),
    ).toEqual({ kind: 'ignored' });
  });

  it('[BM-040] repairs a gap from a fresh durable read without dropping later messages', async () => {
    const repaired = snapshot({
      chatSequence: 4n,
      messages: [
        {
          id: nextMessageId,
          membershipId: '01941f29-7c00-7000-8000-000000000621',
          authorDisplayName: 'Ada',
          body: 'Caught up',
          sequence: 4n,
          createdAt: new Date('2026-09-18T14:04:00.000Z'),
        },
      ],
    });
    const result = await applyChatRealtimeEventOrRepair(
      snapshot(),
      {
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: nextMessageId,
        sequence: 1n,
        payload: {
          nightId,
          messageId: nextMessageId,
          membershipId: '01941f29-7c00-7000-8000-000000000621',
          authorDisplayName: 'Ada',
          body: 'Caught up',
          createdAt: '2026-09-18T14:04:00.000Z',
          chatSequence: '4',
        },
      },
      async () => repaired,
    );
    expect(result).toEqual({ snapshot: repaired, outcome: 'repaired' });
  });

  it('[BM-040] keeps a newer live snapshot when a reconnect read is stale', () => {
    const live = snapshot({ chatSequence: 3n });
    expect(retainNewerHouseChat(snapshot(), live)).toBe(live);
    expect(retainNewerHouseChat(live, snapshot())).toBe(live);
  });

  it('[BM-040] bounds the live window to the recent durable page', () => {
    const filled = snapshot({
      chatSequence: BigInt(HOUSE_CHAT_RECENT_LIMIT),
      messages: Array.from({ length: HOUSE_CHAT_RECENT_LIMIT }, (_, index) => ({
        id: `01941f29-7c00-7000-8000-${String(index + 1).padStart(12, '0')}`,
        membershipId: '01941f29-7c00-7000-8000-000000000623',
        authorDisplayName: 'Bea',
        body: `Message ${String(index + 1)}`,
        sequence: BigInt(index + 1),
        createdAt,
      })),
    });
    const applied = applyChatRealtimeEvent(filled, {
      topic: NIGHT_CHAT_POSTED_TOPIC,
      aggregateId: nextMessageId,
      sequence: 1n,
      payload: {
        nightId,
        messageId: nextMessageId,
        membershipId: '01941f29-7c00-7000-8000-000000000621',
        authorDisplayName: 'Ada',
        body: 'Newest',
        createdAt: '2026-09-18T14:10:00.000Z',
        chatSequence: String(HOUSE_CHAT_RECENT_LIMIT + 1),
      },
    });
    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') return;
    expect(applied.snapshot.messages).toHaveLength(HOUSE_CHAT_RECENT_LIMIT);
    expect(applied.snapshot.messages.at(-1)?.body).toBe('Newest');
  });
});
