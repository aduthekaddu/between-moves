import { defineConfig } from '@trigger.dev/sdk/v3';

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? 'between-moves-local',
  dirs: ['./src/trigger'],
  maxDuration: 120,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
