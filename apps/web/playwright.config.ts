import { defineConfig } from '@playwright/test';
import { e2eEnvironment } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
  },
  webServer: {
    command: 'pnpm build && pnpm start --port 3100',
    url: 'http://127.0.0.1:3100/healthz',
    env: e2eEnvironment,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
