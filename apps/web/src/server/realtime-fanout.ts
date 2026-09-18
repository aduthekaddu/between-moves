import type { RealtimePublishEnvelope } from '@between-moves/adapters';

export type RealtimeFanoutListener = (envelope: RealtimePublishEnvelope) => void;

/** [BM-038] Process-local Night subscribers; hosted providers replace this in production scale-out. */
export class RealtimeNightFanout {
  private readonly listeners = new Map<string, Set<RealtimeFanoutListener>>();
  private readonly seen = new Set<string>();

  publish(nightId: string, envelope: RealtimePublishEnvelope): 'published' | 'duplicate' {
    if (this.seen.has(envelope.id)) return 'duplicate';
    this.seen.add(envelope.id);
    const listeners = this.listeners.get(nightId);
    if (listeners !== undefined) {
      for (const listener of listeners) listener(envelope);
    }
    return 'published';
  }

  subscribe(nightId: string, listener: RealtimeFanoutListener): () => void {
    const listeners = this.listeners.get(nightId) ?? new Set<RealtimeFanoutListener>();
    listeners.add(listener);
    this.listeners.set(nightId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(nightId);
    };
  }
}

const globalFanout = globalThis as typeof globalThis & {
  betweenMovesRealtimeFanout?: RealtimeNightFanout;
};

export function getRealtimeNightFanout(): RealtimeNightFanout {
  globalFanout.betweenMovesRealtimeFanout ??= new RealtimeNightFanout();
  return globalFanout.betweenMovesRealtimeFanout;
}
