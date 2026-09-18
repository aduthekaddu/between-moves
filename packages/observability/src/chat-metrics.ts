export interface ChatMetricSnapshot {
  readonly chat_send_total: number;
  readonly chat_delete_total: number;
  readonly rate_limit_hit_total: number;
}

export interface ChatMetricStubs {
  incrementChatSend(): void;
  incrementChatDelete(): void;
  incrementRateLimitHit(): void;
  snapshot(): ChatMetricSnapshot;
}

/** [BM-040] In-process seam for House-chat send, delete, and rate-limit counters. */
export function createChatMetricStubs(): ChatMetricStubs {
  let chatSends = 0;
  let chatDeletes = 0;
  let rateLimitHits = 0;
  return {
    incrementChatSend() {
      chatSends += 1;
    },
    incrementChatDelete() {
      chatDeletes += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    snapshot() {
      return {
        chat_send_total: chatSends,
        chat_delete_total: chatDeletes,
        rate_limit_hit_total: rateLimitHits,
      };
    },
  };
}
