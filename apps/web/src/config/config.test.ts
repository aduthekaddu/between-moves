import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './index';

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

describe('loadConfig', () => {
  it('[BM-003] [DR-SEC-03] rejects missing required keys by name without exposing values', () => {
    const { BETTER_AUTH_SECRET: omitted, ...environment } = validEnvironment;

    expect(omitted).toBeTruthy();

    try {
      loadConfig(environment);
      expect.unreachable('Expected configuration validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error).toMatchObject({
        missingKeys: ['BETTER_AUTH_SECRET'],
        invalidKeys: [],
      });
      expect(String(error)).toContain('BETTER_AUTH_SECRET');
      expect(String(error)).not.toContain(validEnvironment.RESEND_API_KEY);
      expect(String(error)).not.toContain(validEnvironment.ANALYSIS_WORKER_SECRET);
    }
  });

  it('[BM-009] [DR-SEC-03] fails closed when an Upstash credential is missing', () => {
    const { UPSTASH_REDIS_REST_TOKEN: omitted, ...environment } = validEnvironment;

    expect(omitted).toBeTruthy();
    try {
      loadConfig(environment);
      expect.unreachable('Expected configuration validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error).toMatchObject({
        missingKeys: ['UPSTASH_REDIS_REST_TOKEN'],
        invalidKeys: [],
      });
      expect(String(error)).not.toContain(validEnvironment.UPSTASH_REDIS_REST_TOKEN);
    }
  });

  it('[BM-003] [DR-SEC-03] rejects malformed URLs and insecure database configuration', () => {
    const environment = {
      ...validEnvironment,
      APP_ORIGIN: 'not-a-url',
      DATABASE_URL: 'postgresql://app:test@db.example.test/app',
    };

    try {
      loadConfig(environment);
      expect.unreachable('Expected configuration validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error).toMatchObject({
        missingKeys: [],
        invalidKeys: ['APP_ORIGIN', 'DATABASE_URL'],
      });
    }
  });

  it('[BM-003] [DR-SEC-03] accepts valid configuration and permits unknown keys', () => {
    const config = loadConfig({ ...validEnvironment, HOST_PLATFORM_METADATA: 'allowed' });

    expect(config.environment).toBe('preview');
    expect(config.buildId).toBe('build-123');
    expect(config.appOrigin.href).toBe('https://preview.example.test/');
    expect(config.upstashRedisRestUrl.href).toBe('https://rate-limit.example.test/');
    expect(config.upstashRedisRestToken).toBe('upstash-test-token');
  });
});
