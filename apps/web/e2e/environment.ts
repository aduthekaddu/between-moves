const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export const e2eEnvironment: Record<string, string> = {
  ...inheritedEnvironment,
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql://app:test@db.example.test/app?sslmode=require',
  BETTER_AUTH_SECRET: 'e2e-better-auth-secret-at-least-32-characters',
  APP_ORIGIN: 'http://127.0.0.1:3100',
  RESEND_API_KEY: 're_e2e_key',
  RESEND_WEBHOOK_SECRET: 'whsec_e2e_secret',
  REALTIME_APP_ID: 'realtime-e2e-app',
  REALTIME_SERVER_KEY: 'realtime-e2e-server-key',
  REALTIME_PUBLIC_KEY: 'realtime-e2e-public-key',
  ANALYSIS_WORKER_URL: 'http://127.0.0.1:3101',
  ANALYSIS_WORKER_SECRET: 'analysis-e2e-secret',
  APP_ENV: 'local',
  BUILD_ID: 'e2e-build',
};
