import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

describe('BM-051 response security headers', () => {
  it('[BM-051:AC-1] applies strict headers and a fresh request nonce to pages and API routes', () => {
    for (const path of ['/', '/api/viewer', '/healthz', '/missing']) {
      const request = new NextRequest(`https://betweenmoves.test${path}`);
      const first = proxy(request);
      const second = proxy(request);
      const csp = first.headers.get('content-security-policy') ?? '';
      const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];

      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
      expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
      expect(second.headers.get('content-security-policy')).not.toBe(csp);
      expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(first.headers.get('x-frame-options')).toBe('DENY');
      expect(first.headers.get('x-content-type-options')).toBe('nosniff');
      expect(first.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(first.headers.get('strict-transport-security')).toBe(
        'max-age=63072000; includeSubDomains',
      );
    }
  });
});
