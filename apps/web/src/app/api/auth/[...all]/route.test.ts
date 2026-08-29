import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';

describe('Better Auth catch-all magic-link hardening', () => {
  it.each([
    ['POST', POST, '/api/auth/sign-in/magic-link'],
    ['GET', GET, '/api/auth/magic-link/verify?token=secret'],
  ] as const)(
    '[BM-008] blocks raw %s %s so public flows use enumeration-safe contract routes',
    async (_method, handler, path) => {
      const response = await handler(new Request(`https://app.example.test${path}`));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
    },
  );
});
