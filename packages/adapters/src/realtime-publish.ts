import {
  isGameRealtimeTopic,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  NIGHT_ENDED_TOPIC,
  NIGHT_STARTED_TOPIC,
  type ClaimedOutboxEvent,
  type RealtimeChannelResolver,
  type RealtimePublishMessage,
  type RealtimePublisher,
  type RealtimePublishResult,
} from '@between-moves/domain';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { opaqueRealtimeChannelId } from './realtime-token';

export interface RealtimePublishEnvelope {
  readonly id: string;
  readonly channel: string;
  readonly name: string;
  readonly sequence: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

function envelopeFor(message: RealtimePublishMessage): RealtimePublishEnvelope {
  return {
    id: message.eventId,
    channel: message.channel,
    name: message.topic,
    sequence: message.sequence.toString(),
    data: {
      houseId: message.houseId,
      aggregateId: message.aggregateId,
      ...message.payload,
    },
    occurredAt: message.occurredAt.toISOString(),
  };
}

function publishKey(serverKey: string): Buffer {
  return createHash('sha256')
    .update('between-moves:realtime-publish\0', 'utf8')
    .update(serverKey, 'utf8')
    .digest();
}

/** [BM-038] HMAC over the JSON envelope so REALTIME_SERVER_KEY is not sent as a bearer. */
export function signRealtimePublish(serverKey: string, body: string): string {
  return createHmac('sha256', publishKey(serverKey)).update(body).digest('base64url');
}

export function verifyRealtimePublishSignature(
  serverKey: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signRealtimePublish(serverKey, body), 'base64url');
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** [BM-038] HMAC opaque channels for Night and Game outbox events. */
export class HmacRealtimeChannelResolver implements RealtimeChannelResolver {
  constructor(private readonly serverKey: string) {}

  channelFor(event: ClaimedOutboxEvent): string | null {
    if (event.houseId === null) return null;
    if (isGameRealtimeTopic(event.topic)) {
      return opaqueRealtimeChannelId(this.serverKey, 'game', event.houseId, event.aggregateId);
    }
    if (event.topic === NIGHT_STARTED_TOPIC || event.topic === NIGHT_ENDED_TOPIC) {
      return opaqueRealtimeChannelId(this.serverKey, 'night', event.houseId, event.aggregateId);
    }
    if (event.topic === NIGHT_CHAT_POSTED_TOPIC || event.topic === NIGHT_CHAT_DELETED_TOPIC) {
      const nightId = event.payload.nightId;
      if (typeof nightId !== 'string') return null;
      return opaqueRealtimeChannelId(this.serverKey, 'night', event.houseId, nightId);
    }
    return null;
  }
}

/** [BM-038] In-process publisher that deduplicates by outbox event ID. */
export class MemoryRealtimePublisher implements RealtimePublisher {
  readonly envelopes: RealtimePublishEnvelope[] = [];
  private readonly seen = new Set<string>();

  async publish(message: RealtimePublishMessage): Promise<RealtimePublishResult> {
    const envelope = envelopeFor(message);
    if (this.seen.has(envelope.id)) return 'duplicate';
    this.seen.add(envelope.id);
    this.envelopes.push(envelope);
    return 'published';
  }
}

export interface HttpRealtimePublisherOptions {
  readonly url: string;
  readonly serverKey: string;
  readonly fetch?: typeof fetch;
}

/** [BM-038] POST sequenced envelopes to the app fan-out; 409 is a provider duplicate. */
export class HttpRealtimePublisher implements RealtimePublisher {
  constructor(private readonly options: HttpRealtimePublisherOptions) {}

  async publish(message: RealtimePublishMessage): Promise<RealtimePublishResult> {
    const envelope = envelopeFor(message);
    const body = JSON.stringify(envelope);
    const response = await (this.options.fetch ?? fetch)(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-realtime-signature': signRealtimePublish(this.options.serverKey, body),
      },
      body,
    });
    if (response.status === 409) return 'duplicate';
    if (!response.ok) {
      throw new Error(`Realtime publish HTTP ${String(response.status)}`);
    }
    return 'published';
  }
}
