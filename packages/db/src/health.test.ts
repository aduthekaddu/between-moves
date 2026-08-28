import { describe, expect, it, vi } from 'vitest';
import { checkDatabaseHealth, poolSaturation } from './health';

function pool(overrides: Partial<Parameters<typeof checkDatabaseHealth>[0]> = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ reachable: 1 }] }),
    totalCount: 8,
    idleCount: 2,
    waitingCount: 0,
    maxConnections: 10,
    ...overrides,
  };
}

describe('database health', () => {
  it('[BM-004] reports a round-trip query as reachable and observes db_pool_saturation', async () => {
    const databasePool = pool();
    const gauge = { set: vi.fn() };

    await expect(checkDatabaseHealth(databasePool, { gauge })).resolves.toEqual({
      status: 'reachable',
    });
    expect(databasePool.query).toHaveBeenCalledWith('select 1 as reachable');
    expect(gauge.set).toHaveBeenCalledWith('db_pool_saturation', 0.6);
  });

  it('[BM-004] reports connection failure without throwing or logging credentials', async () => {
    const databaseUrl = 'postgresql://app:do-not-log@db.example.test/app?sslmode=require';
    const databasePool = pool({
      query: vi.fn().mockRejectedValue(new Error(`connection failed for ${databaseUrl}`)),
    });
    const logger = { error: vi.fn() };

    await expect(checkDatabaseHealth(databasePool, { logger })).resolves.toEqual({
      status: 'unreachable',
    });
    expect(logger.error).toHaveBeenCalledOnce();

    const serializedLog = JSON.stringify(logger.error.mock.calls[0]?.[0]);
    expect(serializedLog).toContain('db.connection-failed');
    expect(serializedLog).not.toContain(databaseUrl);
    expect(serializedLog).not.toContain('do-not-log');
  });

  it('[BM-004] clamps db_pool_saturation to a zero-to-one ratio', () => {
    expect(poolSaturation(pool())).toBe(0.6);
    expect(poolSaturation(pool({ totalCount: 20, idleCount: 0 }))).toBe(1);
    expect(poolSaturation(pool({ totalCount: 1, idleCount: 3 }))).toBe(0);
  });
});
