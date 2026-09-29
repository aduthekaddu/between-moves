import { defineConfig } from '@trigger.dev/sdk/v3';

const project = process.env.TRIGGER_PROJECT_ID;
if (!project?.startsWith('proj_')) {
  throw new Error(
    'Set TRIGGER_PROJECT_ID to the proj_ reference from Trigger.dev project settings',
  );
}

export default defineConfig({
  project,
  dirs: ['./src/trigger'],
  maxDuration: 120,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
