import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readSeasonStandings as readSeasonStandingsUseCase,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgSeasonScoringRepository,
} from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type SeasonStandings,
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

export interface SeasonStandingsReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readSeasonStandings: (query: {
    readonly houseId: string;
    readonly seasonId: string;
    readonly viewer: Viewer;
  }) => Promise<SeasonStandings | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type SeasonStandingsReader = (
  request: Request,
  houseId: string,
  seasonId: string,
) => Promise<SeasonStandings | null>;

/** [BM-034] Hide unauthorized standings and log only scoped read metadata. */
export function createSeasonStandingsReader(
  dependencies: SeasonStandingsReaderDependencies,
): SeasonStandingsReader {
  return async (request, houseId, seasonId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let result: SeasonStandings | null;
    try {
      result = await dependencies.readSeasonStandings({ houseId, seasonId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (result === null) return null;
    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
      actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
      houseId,
      gameId: null,
      commandId: null,
      event: 'season.standings-viewed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: { season_id: seasonId },
    });
    return result;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();
const clock = new SystemClock();

/** [BM-034] Web composition for the House+Season-scoped standings query. */
export function getSeasonStandings(
  request: Request,
  houseId: string,
  seasonId: string,
): Promise<SeasonStandings | null> {
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
  return createSeasonStandingsReader({
    getViewer,
    readSeasonStandings: (query) =>
      readSeasonStandingsUseCase(query, {
        authorizeHouseAction,
        scoring: new PgSeasonScoringRepository(database),
      }),
    logger: getLogger(),
    clock,
  })(request, houseId, seasonId);
}
