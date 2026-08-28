import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { checkDatabaseHealth, type DatabaseHealth, type HealthPool } from './health';

const DEFAULT_MAX_CONNECTIONS = 10;
const TLS_DATABASE_URL_ERROR = 'DATABASE_URL must be a PostgreSQL URL with sslmode=require';

export interface Database {
  readonly pool: Pool;
  readonly orm: NodePgDatabase;
  checkHealth(): Promise<DatabaseHealth>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}

/** [BM-004] Runtime connections fail closed unless PostgreSQL TLS is required by the URL. */
export function assertTlsDatabaseUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(TLS_DATABASE_URL_ERROR);
  }

  const isPostgres = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  if (!isPostgres || url.searchParams.get('sslmode') !== 'require') {
    throw new Error(TLS_DATABASE_URL_ERROR);
  }
}

function healthPool(pool: Pool, maxConnections: number): HealthPool {
  return {
    query: (sql) => pool.query(sql),
    get totalCount() {
      return pool.totalCount;
    },
    get idleCount() {
      return pool.idleCount;
    },
    get waitingCount() {
      return pool.waitingCount;
    },
    maxConnections,
  };
}

/** [BM-004] Create the shared pg pool and Drizzle adapter for a composition root. */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  assertTlsDatabaseUrl(connectionString);
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    allowExitOnIdle: true,
  });

  return {
    pool,
    orm: drizzle(pool),
    checkHealth: () => checkDatabaseHealth(healthPool(pool, maxConnections)),
    close: () => pool.end(),
  };
}
