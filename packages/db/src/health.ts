export interface DatabaseHealth {
  readonly status: 'reachable' | 'unreachable';
}

export interface HealthPool {
  query(sql: string): Promise<unknown>;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly maxConnections: number;
}

interface DatabaseLogEntry {
  readonly ts: string;
  readonly level: 'error';
  readonly request_id: null;
  readonly actor_id: 'anonymous';
  readonly house_id: null;
  readonly game_id: null;
  readonly command_id: null;
  readonly event: 'db.connection-failed';
  readonly outcome: 'error';
  readonly duration_ms: number;
  readonly error_name: string;
  readonly error_code?: string;
}

export interface DatabaseLogger {
  error(entry: DatabaseLogEntry): void;
}

export interface Gauge {
  set(name: 'db_pool_saturation', value: number): void;
}

const defaultLogger: DatabaseLogger = {
  error: (entry) => console.error(JSON.stringify(entry)),
};

const noOpGauge: Gauge = { set: () => undefined };

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && /^[A-Z0-9_]+$/i.test(code) ? code : undefined;
}

/** [BM-004] Report utilization as a bounded, low-cardinality gauge value. */
export function poolSaturation(pool: HealthPool): number {
  if (pool.maxConnections <= 0) return 0;
  const activeConnections = pool.totalCount - pool.idleCount;
  return Math.min(1, Math.max(0, activeConnections / pool.maxConnections));
}

/** [BM-004] Probe PostgreSQL without throwing or serializing connection details. */
export async function checkDatabaseHealth(
  pool: HealthPool,
  dependencies: { readonly logger?: DatabaseLogger; readonly gauge?: Gauge } = {},
): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  const logger = dependencies.logger ?? defaultLogger;
  const gauge = dependencies.gauge ?? noOpGauge;

  try {
    await pool.query('select 1 as reachable');
    gauge.set('db_pool_saturation', poolSaturation(pool));
    return { status: 'reachable' };
  } catch (error) {
    gauge.set('db_pool_saturation', poolSaturation(pool));
    const errorCode = safeErrorCode(error);
    logger.error({
      ts: new Date().toISOString(),
      level: 'error',
      request_id: null,
      actor_id: 'anonymous',
      house_id: null,
      game_id: null,
      command_id: null,
      event: 'db.connection-failed',
      outcome: 'error',
      duration_ms: Date.now() - startedAt,
      error_name: error instanceof Error ? error.name : 'UnknownError',
      ...(errorCode ? { error_code: errorCode } : {}),
    });
    return { status: 'unreachable' };
  }
}
