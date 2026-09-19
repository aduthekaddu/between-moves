import { houseChatSnapshotSchema, type HouseChatSnapshotResponse } from '@between-moves/contracts';
import type { HouseChatSnapshot } from '@between-moves/domain';

function iso(value: Date): string {
  return value.toISOString();
}

function instant(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid House chat timestamp');
  return parsed;
}

/** [BM-040] JSON snapshot with decimal sequences for the House chat wire format. */
export function serializeHouseChatSnapshot(snapshot: HouseChatSnapshot): HouseChatSnapshotResponse {
  return houseChatSnapshotSchema.parse({
    houseId: snapshot.houseId,
    nightId: snapshot.nightId,
    chatSequence: snapshot.chatSequence.toString(),
    currentMembershipId: snapshot.currentMembershipId,
    canModerate: snapshot.canModerate,
    messages: snapshot.messages.map((message) => ({
      id: message.id,
      membershipId: message.membershipId,
      authorDisplayName: message.authorDisplayName,
      body: message.body,
      sequence: message.sequence.toString(),
      createdAt: iso(message.createdAt),
    })),
  });
}

/** [BM-040] Restore bigint sequences after a JSON chat read. */
export function parseHouseChatSnapshot(payload: HouseChatSnapshotResponse): HouseChatSnapshot {
  const parsed = houseChatSnapshotSchema.parse(payload);
  return {
    houseId: parsed.houseId,
    nightId: parsed.nightId,
    chatSequence: BigInt(parsed.chatSequence),
    currentMembershipId: parsed.currentMembershipId,
    canModerate: parsed.canModerate,
    messages: parsed.messages.map((message) => ({
      id: message.id,
      membershipId: message.membershipId,
      authorDisplayName: message.authorDisplayName,
      body: message.body,
      sequence: BigInt(message.sequence),
      createdAt: instant(message.createdAt),
    })),
  };
}
