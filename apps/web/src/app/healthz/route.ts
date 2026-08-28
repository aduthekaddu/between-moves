import type { DatabaseHealth } from '@between-moves/db';
import { appMetadata, getConfig, type AppConfig } from '../../config';
import { checkDatabaseReadiness } from '../../server/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type DatabaseHealthCheck = () => Promise<DatabaseHealth>;

export async function createHealthResponse(
  config: AppConfig,
  checkDatabase: DatabaseHealthCheck = checkDatabaseReadiness,
): Promise<Response> {
  const database = await checkDatabase();
  const healthy = database.status === 'reachable';

  return Response.json(
    {
      status: healthy ? 'ok' : 'unhealthy',
      app: appMetadata,
      build: {
        id: config.buildId,
        environment: config.environment,
      },
      database,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** [BM-003] [BM-004] Liveness metadata plus PostgreSQL readiness. */
export function GET(): Promise<Response> {
  return createHealthResponse(getConfig());
}
