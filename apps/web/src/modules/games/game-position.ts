import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readGamePosition as readGamePositionUseCase,
} from '@between-moves/application';
import {
  PgGamePositionRepository,
  PgHouseAuthorizationMembershipRepository,
} from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type GamePosition,
  type ReadGamePositionQuery,
  type Viewer,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  type StructuredLogger,
} from '@between-moves/observability';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getViewer } from '../../server/viewer';

export interface GamePositionReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readGamePosition: (query: ReadGamePositionQuery) => Promise<GamePosition | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type GamePositionReader = (
  request: Request,
  houseId: string,
  gameId: string,
) => Promise<GamePosition | null>;

/** [BM-027] Hide unauthorized Games and record successful canonical board views. */
export function createGamePositionReader(
  dependencies: GamePositionReaderDependencies,
): GamePositionReader {
  return async (request, houseId, gameId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let position: GamePosition | null;
    try {
      position = await dependencies.readGamePosition({ houseId, gameId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (position === null) return null;

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
      actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
      houseId,
      gameId,
      commandId: null,
      event: 'game.position-viewed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
    });
    return position;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();
const clock = new SystemClock();

/** [BM-027] Web composition for a Member-scoped canonical Game read. */
export function getGamePosition(
  request: Request,
  houseId: string,
  gameId: string,
): Promise<GamePosition | null> {
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

  return createGamePositionReader({
    getViewer,
    readGamePosition: (query) =>
      readGamePositionUseCase(query, {
        authorizeHouseAction,
        games: new PgGamePositionRepository(database),
      }),
    logger: getLogger(),
    clock,
  })(request, houseId, gameId);
}
