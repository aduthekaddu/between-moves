import { appMetadata, getConfig, type AppConfig } from '../../config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function createHealthResponse(config: AppConfig): Response {
  return Response.json(
    {
      status: 'ok',
      app: appMetadata,
      build: {
        id: config.buildId,
        environment: config.environment,
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** [BM-003] Liveness only; BM-004 adds database readiness. */
export function GET(): Response {
  return createHealthResponse(getConfig());
}
