import { describe, expect, it, vi } from 'vitest';
import { ConfigValidationError } from './index';
import { startApplication } from './startup';

const validEnvironment = {
  DATABASE_URL: 'postgresql://app:test@db.example.test/app?sslmode=require',
  BETTER_AUTH_SECRET: 'better-auth-secret-with-at-least-32-characters',
  APP_ORIGIN: 'https://preview.example.test',
  RESEND_API_KEY: 're_test_key',
  RESEND_WEBHOOK_SECRET: 'whsec_test_secret',
  REALTIME_APP_ID: 'realtime-test-app',
  REALTIME_SERVER_KEY: 'realtime-test-server-key',
  REALTIME_PUBLIC_KEY: 'realtime-test-public-key',
  ANALYSIS_WORKER_URL: 'https://worker.example.test',
  ANALYSIS_WORKER_SECRET: 'analysis-test-secret',
  UPSTASH_REDIS_REST_URL: 'https://rate-limit.example.test',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-test-token',
  APP_ENV: 'preview',
  BUILD_ID: 'build-123',
} as const;

describe('startApplication', () => {
  it('[BM-003] fails boot and logs only missing key names when configuration is absent', () => {
    const { REALTIME_SERVER_KEY: omitted, ...environment } = validEnvironment;
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(omitted).toBeTruthy();
    expect(() => startApplication(environment, logger)).toThrow(ConfigValidationError);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();

    const entry = logger.error.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      event: 'app.startup-failed',
      outcome: 'error',
      missing_keys: ['REALTIME_SERVER_KEY'],
      invalid_keys: [],
    });

    const serializedEntry = JSON.stringify(entry);
    for (const value of Object.values(validEnvironment)) {
      expect(serializedEntry).not.toContain(value);
    }
  });

  it('[BM-003] logs environment and build metadata after valid startup', () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    startApplication(validEnvironment, logger);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'app.started',
        outcome: 'success',
        environment: 'preview',
        build_id: 'build-123',
      }),
    );
  });
});
