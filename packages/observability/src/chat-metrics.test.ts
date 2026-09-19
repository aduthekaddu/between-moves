import { describe, expect, it } from 'vitest';
import { createChatMetricStubs } from './chat-metrics';

describe('House chat metrics', () => {
  it('[BM-040] counts sends, deletes, and rate-limit denials without bodies', () => {
    const metrics = createChatMetricStubs();
    metrics.incrementChatSend();
    metrics.incrementChatSend();
    metrics.incrementChatDelete();
    metrics.incrementRateLimitHit();
    expect(metrics.snapshot()).toEqual({
      chat_send_total: 2,
      chat_delete_total: 1,
      rate_limit_hit_total: 1,
    });
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(/body|hello|script/i);
  });
});
