import { defineConfig } from '@playwright/test';
import { assertTestDatabaseReachable } from '@between-moves/db/test-database';
import { e2eEnvironment } from './e2e/environment';

// Playwright starts webServer before globalSetup, and /healthz waits on PostgreSQL,
// so the database check runs here to fail before the build instead of after a timeout.
await assertTestDatabaseReachable();

const everyTestRan = ['./e2e/support/every-test-ran-reporter.ts'] as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], everyTestRan]
    : [['list'], everyTestRan],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:3100',
  },
  webServer: {
    command: 'pnpm build && pnpm start --port 3100',
    url: 'http://127.0.0.1:3100/healthz',
    env: e2eEnvironment,
    // A server already on this port may use another database, so e2e always starts its own.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
