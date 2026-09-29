import type { RealtimePublishEnvelope } from '@between-moves/adapters';
import { isGameRealtimeTopic } from '@between-moves/domain';

export type RealtimeFanoutListener = (envelope: RealtimePublishEnvelope) => void;

/** [BM-038] [BM-043] Process-local Night and Game subscribers. */
export class RealtimeNightFanout {
  private readonly listeners = new Map<string, Set<RealtimeFanoutListener>>();
  private readonly gameListeners = new Map<string, Set<RealtimeFanoutListener>>();
  private readonly seen = new Set<string>();

  publish(nightId: string | null, envelope: RealtimePublishEnvelope): 'published' | 'duplicate' {
    if (this.seen.has(envelope.id)) return 'duplicate';
    this.seen.add(envelope.id);
    const listeners = nightId === null ? undefined : this.listeners.get(nightId);
    if (listeners !== undefined) {
      for (const listener of listeners) listener(envelope);
    }
    if (isGameRealtimeTopic(envelope.name)) {
      for (const listener of this.gameListeners.get(envelope.channel) ?? []) listener(envelope);
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

  subscribeGame(channel: string, listener: RealtimeFanoutListener): () => void {
    const listeners = this.gameListeners.get(channel) ?? new Set<RealtimeFanoutListener>();
    listeners.add(listener);
    this.gameListeners.set(channel, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.gameListeners.delete(channel);
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
