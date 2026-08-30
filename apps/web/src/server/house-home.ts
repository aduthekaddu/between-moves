import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readHouseHome as readHouseHomeUseCase,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgHouseHomeRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type HouseHome,
  type ReadHouseHomeQuery,
  type Viewer,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  type StructuredLogger,
} from '@between-moves/observability';
import { getDatabase } from './database';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getLogger } from './logger';
import { getViewer } from './viewer';

export interface HouseHomeReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readHouseHome: (query: ReadHouseHomeQuery) => Promise<HouseHome | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type HouseHomeReader = (request: Request, houseId: string) => Promise<HouseHome | null>;

/** [BM-013] Hide House existence while logging only successful member views. */
export function createHouseHomeReader(dependencies: HouseHomeReaderDependencies): HouseHomeReader {
  return async (request, houseId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let home: HouseHome | null;
    try {
      home = await dependencies.readHouseHome({ houseId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (home === null) return null;

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
      actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
      houseId,
      gameId: null,
      commandId: null,
      event: 'house.home-viewed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
    });

    return home;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();
const clock = new SystemClock();

/** [BM-013] Web composition for the member-scoped House home read. */
export function getHouseHome(request: Request, houseId: string): Promise<HouseHome | null> {
  const database = getDatabase().pool;
  const requestId = request.headers.get('x-request-id') ?? 'request-unavailable';
  const authorizeHouseAction = createAuthorizeHouseAction({
    memberships: new PgHouseAuthorizationMembershipRepository(database),
    nightHosts: { isAssignedNightHost: async () => false },
    denials: createHouseAuthorizationDenialRecorder({
      logger: getLogger(),
      metrics: authorizationMetrics,
      requestId,
    }),
  });
  const readHouseHome = (query: ReadHouseHomeQuery) =>
    readHouseHomeUseCase(query, {
      authorizeHouseAction,
      houses: new PgHouseHomeRepository(database),
    });

  return createHouseHomeReader({
    getViewer,
    readHouseHome,
    logger: getLogger(),
    clock,
  })(request, houseId);
}
