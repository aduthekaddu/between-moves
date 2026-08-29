import { createDatabase, type Database, type DatabaseHealth } from '@between-moves/db';
import { getConfig } from '../config';

const globalDatabase = globalThis as typeof globalThis & {
  betweenMovesDatabase?: Database;
};

export function getDatabase(): Database {
  globalDatabase.betweenMovesDatabase ??= createDatabase(getConfig().databaseUrl);
  return globalDatabase.betweenMovesDatabase;
}

/** [BM-004] Composition-root seam for request handlers; no database details cross it. */
export function checkDatabaseReadiness(): Promise<DatabaseHealth> {
  return getDatabase().checkHealth();
}
