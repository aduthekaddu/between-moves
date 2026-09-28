import { describe, expect, it, vi } from 'vitest';
import { createChatRateLimit } from './chat-rate-limit';
import {
  createInvitationRateLimit,
  type InvitationRateLimitSurface,
} from './invitation-rate-limit';
import { createMoveRateLimit } from './move-rate-limit';
import { createReactionRateLimit } from './reaction-rate-limit';
import { InMemoryRateLimiter } from './rate-limit';

const request = new Request('https://betweenmoves.test/api/surface', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-051 remaining rate limits', () => {
  it.each([
    ['move', createMoveRateLimit, 60],
    ['chat', createChatRateLimit, 20],
    ['reaction', createReactionRateLimit, 60],
  ] as const)(
    '[BM-051:AC-2] %s denies at the account threshold without leaking identity',
    async (_name, create, threshold) => {
      const incrementRateLimitHit = vi.fn();
      const limit = create({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        incrementRateLimitHit,
        onStoreError: vi.fn(),
      });
      for (let attempt = 0; attempt < threshold; attempt += 1) {
        expect((await limit(request, 'private-account-id')).allowed).toBe(true);
      }
      const denied = await limit(request, 'private-account-id');
      expect(denied).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) });
      expect(denied.retryAfterSeconds).toBeGreaterThan(0);
      expect(JSON.stringify(denied)).not.toContain('private-account-id');
      expect(incrementRateLimitHit).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['create', 20],
    ['inspect', 30],
    ['redeem', 10],
  ] as const)(
    '[BM-051:AC-2] invitation %s denies at the account threshold',
    async (surface, threshold) => {
      const incrementRateLimitHit = vi.fn();
      const limit = createInvitationRateLimit({
        primary: new InMemoryRateLimiter(),
        incrementRateLimitHit,
        onStoreError: vi.fn(),
      });
      for (let attempt = 0; attempt < threshold; attempt += 1) {
        expect(
          (await limit(request, 'private-account-id', surface as InvitationRateLimitSurface))
            .allowed,
        ).toBe(true);
      }
      const denied = await limit(request, 'private-account-id', surface);
      expect(denied).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) });
      expect(denied.retryAfterSeconds).toBeGreaterThan(0);
      expect(JSON.stringify(denied)).not.toContain('private-account-id');
      expect(incrementRateLimitHit).toHaveBeenCalledExactlyOnceWith(surface);
    },
  );
});
