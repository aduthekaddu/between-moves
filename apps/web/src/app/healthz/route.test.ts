import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { createHealthResponse } from './route';

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

describe('GET /healthz', () => {
  it('[BM-003] returns 200 with app and build information', async () => {
    const response = await createHealthResponse(loadConfig(validEnvironment), async () => ({
      status: 'reachable',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      app: {
        name: 'between-moves',
        version: '0.0.0',
      },
      build: {
        id: 'build-123',
        environment: 'preview',
      },
      database: {
        status: 'reachable',
      },
    });
  });

  it('[BM-004] reports the database as reachable without exposing connection details', async () => {
    const response = await createHealthResponse(loadConfig(validEnvironment), async () => ({
      status: 'reachable',
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 'ok',
      database: { status: 'reachable' },
    });
    expect(body).not.toContain(validEnvironment.DATABASE_URL);
  });

  it('[BM-004] reports an unreachable database as unhealthy without throwing', async () => {
    const response = await createHealthResponse(loadConfig(validEnvironment), async () => ({
      status: 'unreachable',
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      status: 'unhealthy',
      database: { status: 'unreachable' },
    });
  });
});
