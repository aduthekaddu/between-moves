import { z } from 'zod';

const requiredValue = z.string().trim().min(1);

const databaseUrl = requiredValue.superRefine((value, context) => {
  try {
    const url = new URL(value);
    const validProtocol = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    const requiresTls = url.searchParams.get('sslmode') === 'require';

    if (!validProtocol || !requiresTls) {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must be a PostgreSQL URL with sslmode=require',
      });
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'DATABASE_URL must be a valid URL' });
  }
});

const environmentSchema = z
  .object({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: requiredValue.min(32),
    APP_ORIGIN: z.url(),
    RESEND_API_KEY: requiredValue,
    RESEND_WEBHOOK_SECRET: requiredValue,
    REALTIME_APP_ID: requiredValue,
    REALTIME_SERVER_KEY: requiredValue,
    REALTIME_PUBLIC_KEY: requiredValue,
    ANALYSIS_WORKER_URL: z.url(),
    ANALYSIS_WORKER_SECRET: requiredValue,
    UPSTASH_REDIS_REST_URL: z.url(),
    UPSTASH_REDIS_REST_TOKEN: requiredValue,
    APP_ENV: z.enum(['local', 'preview', 'staging', 'production']).optional(),
    BUILD_ID: requiredValue.optional(),
    VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
    VERCEL_GIT_COMMIT_SHA: requiredValue.optional(),
  })
  .passthrough();

export const appMetadata = {
  name: 'between-moves',
  version: '0.0.0',
} as const;

export type AppEnvironment = 'local' | 'preview' | 'staging' | 'production';

export interface AppConfig {
  readonly databaseUrl: string;
  readonly betterAuthSecret: string;
  readonly appOrigin: URL;
  readonly resendApiKey: string;
  readonly resendWebhookSecret: string;
  readonly realtimeAppId: string;
  readonly realtimeServerKey: string;
  readonly realtimePublicKey: string;
  readonly analysisWorkerUrl: URL;
  readonly analysisWorkerSecret: string;
  readonly upstashRedisRestUrl: URL;
  readonly upstashRedisRestToken: string;
  readonly environment: AppEnvironment;
  readonly buildId: string;
}

export class ConfigValidationError extends Error {
  readonly missingKeys: readonly string[];
  readonly invalidKeys: readonly string[];

  constructor(missingKeys: string[], invalidKeys: string[]) {
    const details = [
      missingKeys.length > 0 ? `missing ${missingKeys.join(', ')}` : '',
      invalidKeys.length > 0 ? `invalid ${invalidKeys.join(', ')}` : '',
    ].filter(Boolean);

    super(`Invalid application configuration: ${details.join('; ')}`);
    this.name = 'ConfigValidationError';
    this.missingKeys = Object.freeze(missingKeys);
    this.invalidKeys = Object.freeze(invalidKeys);
  }
}

function resolveEnvironment(values: z.output<typeof environmentSchema>): AppEnvironment {
  if (values.APP_ENV) return values.APP_ENV;
  if (values.VERCEL_ENV === 'preview') return 'preview';
  if (values.VERCEL_ENV === 'production') return 'production';
  return 'local';
}

function validationError(
  environment: Readonly<Record<string, string | undefined>>,
  error: z.ZodError,
): ConfigValidationError {
  const keys = new Set(error.issues.map((issue) => String(issue.path[0])));
  const missingKeys = [...keys].filter((key) => environment[key] === undefined).sort();
  const invalidKeys = [...keys].filter((key) => environment[key] !== undefined).sort();
  return new ConfigValidationError(missingKeys, invalidKeys);
}

/** [BM-003] [DR-SEC-03] Parse untrusted server environment values without exposing them. */
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw validationError(environment, result.error);
  }

  const values = result.data;
  return Object.freeze({
    databaseUrl: values.DATABASE_URL,
    betterAuthSecret: values.BETTER_AUTH_SECRET,
    appOrigin: new URL(values.APP_ORIGIN),
    resendApiKey: values.RESEND_API_KEY,
    resendWebhookSecret: values.RESEND_WEBHOOK_SECRET,
    realtimeAppId: values.REALTIME_APP_ID,
    realtimeServerKey: values.REALTIME_SERVER_KEY,
    realtimePublicKey: values.REALTIME_PUBLIC_KEY,
    analysisWorkerUrl: new URL(values.ANALYSIS_WORKER_URL),
    analysisWorkerSecret: values.ANALYSIS_WORKER_SECRET,
    upstashRedisRestUrl: new URL(values.UPSTASH_REDIS_REST_URL),
    upstashRedisRestToken: values.UPSTASH_REDIS_REST_TOKEN,
    environment: resolveEnvironment(values),
    buildId: values.BUILD_ID ?? values.VERCEL_GIT_COMMIT_SHA ?? 'local',
  });
}

let applicationConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  applicationConfig ??= loadConfig();
  return applicationConfig;
}
