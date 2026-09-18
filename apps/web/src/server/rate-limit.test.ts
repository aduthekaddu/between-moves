import { UpstashRateLimiter } from '@between-moves/adapters';
import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import { createSharedRateLimiter } from './rate-limit';

const config = {
  environment: 'local' as const,
  upstashRedisRestUrl: new URL('https://rate-limit.example.test'),
  upstashRedisRestToken: 'upstash-test-token',
};

describe('shared rate-limit provider', () => {
  it('[BM-039] keeps local E2E rate limits in process', () => {
    expect(createSharedRateLimiter(config)).toBeInstanceOf(InMemoryRateLimiter);
  });

  it('[BM-039] uses Upstash outside local environments', () => {
    expect(createSharedRateLimiter({ ...config, environment: 'preview' })).toBeInstanceOf(
      UpstashRateLimiter,
    );
  });
});
