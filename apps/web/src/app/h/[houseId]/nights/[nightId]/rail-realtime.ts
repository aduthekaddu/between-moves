import type { NightRailSnapshotResponse } from '@between-moves/contracts';
import { applyRailRealtimeEventOrRepair, type RailRealtimeEvent } from '@between-moves/domain';
import {
  parseNightRailSnapshot,
  serializeNightRailSnapshot,
} from '../../../../../modules/nights/rail-snapshot';

export interface RailWireEvent {
  readonly topic: string;
  readonly aggregateId: string;
  readonly sequence: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function asDomainEvent(event: RailWireEvent): RailRealtimeEvent {
  if (!/^\d+$/.test(event.sequence)) throw new Error('Invalid realtime sequence');
  return {
    topic: event.topic,
    aggregateId: event.aggregateId,
    sequence: BigInt(event.sequence),
    payload: event.payload,
  };
}

/** [BM-038] Apply the next sequenced event, or refetch the durable rail on a gap. */
export async function applyOrRepairNightRail(
  snapshot: NightRailSnapshotResponse,
  event: RailWireEvent,
  readFresh: () => Promise<NightRailSnapshotResponse>,
): Promise<{ snapshot: NightRailSnapshotResponse; outcome: 'applied' | 'ignored' | 'repaired' }> {
  const current = parseNightRailSnapshot(snapshot);
  const result = await applyRailRealtimeEventOrRepair(current, asDomainEvent(event), async () =>
    parseNightRailSnapshot(await readFresh()),
  );
  return {
    snapshot: serializeNightRailSnapshot(result.snapshot),
    outcome: result.outcome,
  };
}
