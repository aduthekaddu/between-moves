import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readMoveShelf as readMoveShelfUseCase,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgMoveShelfRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type MoveShelf,
  type ReadMoveShelfQuery,
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

export interface MoveShelfReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readMoveShelf: (query: ReadMoveShelfQuery) => Promise<MoveShelf | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type MoveShelfReader = (request: Request, houseId: string) => Promise<MoveShelf | null>;

/** [BM-026] Hide unauthorized Houses and record successful Move Shelf views. */
export function createMoveShelfReader(dependencies: MoveShelfReaderDependencies): MoveShelfReader {
  return async (request, houseId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let shelf: MoveShelf | null;
    try {
      shelf = await dependencies.readMoveShelf({ houseId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (shelf === null) return null;

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
      actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
      houseId,
      gameId: null,
      commandId: null,
      event: 'game.move-shelf-viewed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
    });

    return shelf;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();
const clock = new SystemClock();

/** [BM-026] Web composition for the member- and House-scoped Move Shelf query. */
export function getMoveShelf(request: Request, houseId: string): Promise<MoveShelf | null> {
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

  return createMoveShelfReader({
    getViewer,
    readMoveShelf: (query) =>
      readMoveShelfUseCase(query, {
        authorizeHouseAction,
        games: new PgMoveShelfRepository(database),
      }),
    logger: getLogger(),
    clock,
  })(request, houseId);
}
