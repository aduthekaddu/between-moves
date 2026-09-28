import { expect, test } from '@playwright/test';

test('[BM-051:AC-1] page, API, and missing responses carry strict security headers', async ({
  request,
}) => {
  const policies = new Set<string>();
  for (const path of ['/', '/api/viewer', '/missing-security-header-route', '/icon.svg']) {
    const response = await request.get(path);
    const headers = response.headers();
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/]+={0,2}'/);
    expect(csp).not.toContain('unsafe-inline');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    policies.add(csp);
  }
  expect(policies.size).toBe(4);
});

test('[BM-051:AC-1] landing page hydrates without CSP violations', async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction('recordCspViolation', (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const target = event.target;
      (
        window as typeof window & { recordCspViolation: (directive: string) => void }
      ).recordCspViolation(
        `${event.violatedDirective}:${target instanceof Element ? `${target.tagName}.${target.className}` : 'unknown'}`,
      );
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Between Moves', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(violations).toEqual([]);
});
