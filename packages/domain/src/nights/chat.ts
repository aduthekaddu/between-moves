import type { Viewer } from '../identity';
import type { AuthorizeHouseAction, IdGenerator } from '../houses';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import { DomainError } from '../shared/errors';

export const MAX_HOUSE_CHAT_LENGTH = 2_000;
export const HOUSE_CHAT_RECENT_LIMIT = 50;

export const NIGHT_CHAT_POSTED_TOPIC = 'night.chat-posted';
export const NIGHT_CHAT_DELETED_TOPIC = 'night.chat-deleted';

export const CHAT_REALTIME_TOPICS = [NIGHT_CHAT_POSTED_TOPIC, NIGHT_CHAT_DELETED_TOPIC] as const;

export type ChatRealtimeTopic = (typeof CHAT_REALTIME_TOPICS)[number];

/** [BM-040] [DR-CHAT-02] Enforce the plain-text House-chat storage bound. */
export function validateHouseChatBody(body: string): string {
  const length = [...body].length;
  if (length < 1 || length > MAX_HOUSE_CHAT_LENGTH) {
    throw new DomainError('validation_failed', 'House chat must be 1–2000 characters.');
  }
  return body;
}

export interface HouseChatMessage {
  readonly id: string;
  readonly membershipId: string;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly sequence: bigint;
  readonly createdAt: Date;
}

export interface HouseChatSnapshot {
  readonly houseId: string;
  readonly nightId: string;
  readonly chatSequence: bigint;
  readonly currentMembershipId: string;
  readonly canModerate: boolean;
  readonly messages: readonly HouseChatMessage[];
}

export interface PostHouseChatInput {
  readonly id: string;
  readonly eventId: string;
  readonly nightId: string;
  readonly body: string;
  readonly postedAt: Date;
}

export interface DeleteHouseChatInput {
  readonly eventId: string;
  readonly nightId: string;
  readonly messageId: string;
  readonly deletedAt: Date;
}

export interface HouseChatRepository {
  post(context: AuthorizationContext, input: PostHouseChatInput): Promise<HouseChatMessage>;
  readRecent(context: AuthorizationContext, nightId: string): Promise<HouseChatSnapshot | null>;
  softDelete(context: AuthorizationContext, input: DeleteHouseChatInput): Promise<void>;
}

export interface PostHouseChatRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly body: string;
  readonly viewer: Viewer;
}

export interface ReadHouseChatRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly viewer: Viewer;
}

export interface DeleteHouseChatRequest {
  readonly houseId: string;
  readonly nightId: string;
  readonly messageId: string;
  readonly viewer: Viewer;
}

export interface PostHouseChatDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly chat: HouseChatRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ReadHouseChatDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly chat: HouseChatRepository;
}

export interface DeleteHouseChatDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly chat: HouseChatRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ChatRealtimeEvent {
  readonly topic: string;
  readonly aggregateId: string;
  readonly sequence: bigint;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ApplyChatRealtimeEventResult =
  | { readonly kind: 'applied'; readonly snapshot: HouseChatSnapshot }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'gap' };

function isChatRealtimeTopic(topic: string): topic is ChatRealtimeTopic {
  return (CHAT_REALTIME_TOPICS as readonly string[]).includes(topic);
}

function chatSequenceOf(event: ChatRealtimeEvent): bigint | null {
  const value = event.payload.chatSequence;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'bigint' && value >= 0n) return value;
  return null;
}

function sequenceRelation(current: bigint, incoming: bigint): 'next' | 'stale' | 'gap' {
  if (incoming <= current) return 'stale';
  if (incoming === current + 1n) return 'next';
  return 'gap';
}

function asIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function applyPosted(
  snapshot: HouseChatSnapshot,
  event: ChatRealtimeEvent,
  chatSequence: bigint,
): ApplyChatRealtimeEventResult {
  const messageId = event.payload.messageId;
  const membershipId = event.payload.membershipId;
  const authorDisplayName = event.payload.authorDisplayName;
  const body = event.payload.body;
  const createdAt = asIsoDate(event.payload.createdAt);
  if (
    typeof messageId !== 'string' ||
    typeof membershipId !== 'string' ||
    typeof authorDisplayName !== 'string' ||
    typeof body !== 'string' ||
    createdAt === null
  ) {
    return { kind: 'ignored' };
  }
  if (snapshot.messages.some((message) => message.id === messageId)) {
    return { kind: 'ignored' };
  }
  const relation = sequenceRelation(snapshot.chatSequence, chatSequence);
  if (relation === 'stale') return { kind: 'ignored' };
  if (relation === 'gap') return { kind: 'gap' };
  const posted: HouseChatMessage = {
    id: messageId,
    membershipId,
    authorDisplayName,
    body,
    sequence: chatSequence,
    createdAt,
  };
  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      chatSequence,
      messages: [...snapshot.messages, posted].slice(-HOUSE_CHAT_RECENT_LIMIT),
    },
  };
}

function applyDeleted(
  snapshot: HouseChatSnapshot,
  event: ChatRealtimeEvent,
  chatSequence: bigint,
): ApplyChatRealtimeEventResult {
  const messageId = event.payload.messageId;
  if (typeof messageId !== 'string') return { kind: 'ignored' };
  const relation = sequenceRelation(snapshot.chatSequence, chatSequence);
  if (relation === 'stale') return { kind: 'ignored' };
  if (relation === 'gap') return { kind: 'gap' };
  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      chatSequence,
      messages: snapshot.messages.filter((message) => message.id !== messageId),
    },
  };
}

/** [BM-040] Apply the next chat event, or signal a gap that needs a durable re-read. */
export function applyChatRealtimeEvent(
  snapshot: HouseChatSnapshot,
  event: ChatRealtimeEvent,
): ApplyChatRealtimeEventResult {
  if (!isChatRealtimeTopic(event.topic)) return { kind: 'ignored' };
  const chatSequence = chatSequenceOf(event);
  if (chatSequence === null) return { kind: 'ignored' };
  if (event.topic === NIGHT_CHAT_POSTED_TOPIC) {
    return applyPosted(snapshot, event, chatSequence);
  }
  return applyDeleted(snapshot, event, chatSequence);
}

export type RepairChatRealtimeEventResult = {
  readonly snapshot: HouseChatSnapshot;
  readonly outcome: 'applied' | 'ignored' | 'repaired';
};

/** [BM-040] Apply the next chat sequence, or replace from a durable read on a gap. */
export async function applyChatRealtimeEventOrRepair(
  snapshot: HouseChatSnapshot,
  event: ChatRealtimeEvent,
  readFresh: () => Promise<HouseChatSnapshot>,
): Promise<RepairChatRealtimeEventResult> {
  const result = applyChatRealtimeEvent(snapshot, event);
  if (result.kind === 'applied') return { snapshot: result.snapshot, outcome: 'applied' };
  if (result.kind === 'ignored') return { snapshot, outcome: 'ignored' };
  return { snapshot: await readFresh(), outcome: 'repaired' };
}

/** [BM-040] Keep a newer durable snapshot when a reconnect read races a live apply. */
export function retainNewerHouseChat(
  incoming: HouseChatSnapshot,
  current: HouseChatSnapshot,
): HouseChatSnapshot {
  return incoming.chatSequence >= current.chatSequence ? incoming : current;
}
