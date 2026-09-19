import type { HouseChatSnapshotResponse } from '@between-moves/contracts';
import {
  applyChatRealtimeEventOrRepair,
  NIGHT_CHAT_POSTED_TOPIC,
  retainNewerHouseChat,
  type ChatRealtimeEvent,
} from '@between-moves/domain';
import {
  parseHouseChatSnapshot,
  serializeHouseChatSnapshot,
} from '../../../../../modules/nights/chat-snapshot';

export interface ChatWireEvent {
  readonly topic: string;
  readonly aggregateId: string;
  readonly sequence: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** [BM-040] Turn a durable POST ack into the same event the outbox will publish. */
export function postedChatWireEvent(
  nightId: string,
  message: HouseChatSnapshotResponse['messages'][number],
): ChatWireEvent {
  return {
    topic: NIGHT_CHAT_POSTED_TOPIC,
    aggregateId: message.id,
    sequence: '1',
    payload: {
      nightId,
      messageId: message.id,
      membershipId: message.membershipId,
      authorDisplayName: message.authorDisplayName,
      body: message.body,
      createdAt: message.createdAt,
      chatSequence: message.sequence,
    },
  };
}

function asDomainEvent(event: ChatWireEvent): ChatRealtimeEvent {
  if (!/^\d+$/.test(event.sequence)) throw new Error('Invalid realtime sequence');
  return {
    topic: event.topic,
    aggregateId: event.aggregateId,
    sequence: BigInt(event.sequence),
    payload: event.payload,
  };
}

/** [BM-040] Apply the next sequenced chat event, or refetch durable chat on a gap. */
export async function applyOrRepairHouseChat(
  snapshot: HouseChatSnapshotResponse,
  event: ChatWireEvent,
  readFresh: () => Promise<HouseChatSnapshotResponse>,
): Promise<{
  snapshot: HouseChatSnapshotResponse;
  outcome: 'applied' | 'ignored' | 'repaired';
}> {
  const current = parseHouseChatSnapshot(snapshot);
  const result = await applyChatRealtimeEventOrRepair(current, asDomainEvent(event), async () =>
    parseHouseChatSnapshot(await readFresh()),
  );
  return {
    snapshot: serializeHouseChatSnapshot(result.snapshot),
    outcome: result.outcome,
  };
}

/** [BM-040] Prefer the newer of a reconnect read and a live apply. */
export function retainNewerChatSnapshot(
  incoming: HouseChatSnapshotResponse,
  current: HouseChatSnapshotResponse,
): HouseChatSnapshotResponse {
  return serializeHouseChatSnapshot(
    retainNewerHouseChat(parseHouseChatSnapshot(incoming), parseHouseChatSnapshot(current)),
  );
}
