import { NIGHT_CHAT_POSTED_TOPIC } from '@between-moves/domain';
import { describe, expect, it } from 'vitest';
import {
  applyOrRepairHouseChat,
  postedChatWireEvent,
  retainNewerChatSnapshot,
} from './chat-realtime';

const snapshot = {
  houseId: '01941f29-7c00-7000-8000-000000000201',
  nightId: '01941f29-7c00-7000-8000-000000000901',
  chatSequence: '1',
  currentMembershipId: '01941f29-7c00-7000-8000-000000000621',
  canModerate: false,
  messages: [
    {
      id: '01941f29-7c00-7000-8000-000000000801',
      membershipId: '01941f29-7c00-7000-8000-000000000623',
      authorDisplayName: 'Bea',
      body: 'Already durable',
      sequence: '1',
      createdAt: '2026-09-18T14:00:00.000Z',
    },
  ],
};

describe('House chat realtime attach', () => {
  it('[BM-040] ignores a late publish after a durable reconnect with no gap', async () => {
    const result = await applyOrRepairHouseChat(
      snapshot,
      {
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: snapshot.messages[0]!.id,
        sequence: '1',
        payload: {
          nightId: snapshot.nightId,
          messageId: snapshot.messages[0]!.id,
          membershipId: snapshot.messages[0]!.membershipId,
          authorDisplayName: 'Bea',
          body: 'Already durable',
          createdAt: snapshot.messages[0]!.createdAt,
          chatSequence: '1',
        },
      },
      async () => {
        throw new Error('durable re-read must not run when reconnect already has the message');
      },
    );
    expect(result.outcome).toBe('ignored');
    expect(result.snapshot.chatSequence).toBe('1');
  });

  it('[BM-040] repairs a gap from a fresh durable read', async () => {
    const repaired = {
      ...snapshot,
      chatSequence: '3',
      messages: [
        ...snapshot.messages,
        {
          id: '01941f29-7c00-7000-8000-000000000803',
          membershipId: '01941f29-7c00-7000-8000-000000000621',
          authorDisplayName: 'Ada',
          body: 'Caught up',
          sequence: '3',
          createdAt: '2026-09-18T14:03:00.000Z',
        },
      ],
    };
    const result = await applyOrRepairHouseChat(
      snapshot,
      {
        topic: NIGHT_CHAT_POSTED_TOPIC,
        aggregateId: repaired.messages[1]!.id,
        sequence: '1',
        payload: {
          nightId: snapshot.nightId,
          messageId: repaired.messages[1]!.id,
          membershipId: repaired.messages[1]!.membershipId,
          authorDisplayName: 'Ada',
          body: 'Caught up',
          createdAt: '2026-09-18T14:03:00.000Z',
          chatSequence: '3',
        },
      },
      async () => repaired,
    );
    expect(result).toEqual({ snapshot: repaired, outcome: 'repaired' });
  });

  it('[BM-040] repairs when a POST ack skips a chat sequence instead of jumping the clock', async () => {
    const posted = {
      id: '01941f29-7c00-7000-8000-000000000804',
      membershipId: '01941f29-7c00-7000-8000-000000000621',
      authorDisplayName: 'Ada',
      body: 'My send',
      sequence: '3',
      createdAt: '2026-09-18T14:03:00.000Z',
    };
    const repaired = {
      ...snapshot,
      chatSequence: '3',
      messages: [
        ...snapshot.messages,
        {
          id: '01941f29-7c00-7000-8000-000000000803',
          membershipId: snapshot.messages[0]!.membershipId,
          authorDisplayName: 'Bea',
          body: 'In between',
          sequence: '2',
          createdAt: '2026-09-18T14:02:00.000Z',
        },
        posted,
      ],
    };
    const result = await applyOrRepairHouseChat(
      snapshot,
      postedChatWireEvent(snapshot.nightId, posted),
      async () => repaired,
    );
    expect(result.outcome).toBe('repaired');
    expect(result.snapshot.messages.map((message) => message.id)).toEqual([
      snapshot.messages[0]!.id,
      '01941f29-7c00-7000-8000-000000000803',
      posted.id,
    ]);
  });

  it('[BM-040] keeps a newer live snapshot when reconnect read is stale', () => {
    const live = { ...snapshot, chatSequence: '2' };
    expect(retainNewerChatSnapshot(snapshot, live).chatSequence).toBe('2');
  });
});
