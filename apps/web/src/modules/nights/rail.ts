import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readNightRail as readNightRailUseCase,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgNightRailRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type NightRailSnapshot,
  type Viewer,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  type RealtimeMetricStubs,
  type StructuredLogger,
} from '@between-moves/observability';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getRealtimeMetrics } from '../../server/rate-limit';
import { getViewer } from '../../server/viewer';
export { serializeNightRailSnapshot } from './rail-snapshot';

export interface NightRailReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readNightRail: (query: {
    readonly houseId: string;
    readonly nightId: string;
    readonly viewer: Viewer;
  }) => Promise<NightRailSnapshot | null>;
  readonly logger: StructuredLogger;
  readonly metrics: RealtimeMetricStubs;
  readonly clock: { now(): Date };
}

export type NightRailReader = (
  request: Request,
  houseId: string,
  nightId: string,
) => Promise<NightRailSnapshot | null>;

/** [BM-038] Hide unauthorized rails and record reconnects without leaking tenant data. */
export function createNightRailReader(dependencies: NightRailReaderDependencies): NightRailReader {
  return async (request, houseId, nightId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let result: NightRailSnapshot | null;
    try {
      result = await dependencies.readNightRail({ houseId, nightId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (result === null) return null;
    const repaired = new URL(request.url).searchParams.get('repair') === '1';
    if (repaired) {
      try {
        dependencies.metrics.incrementLiveReconnect();
      } catch {
        // A successful rail read remains successful when metrics are unavailable.
      }
    }
    try {
      dependencies.logger.log({
        level: 'info',
        requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
        actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
        houseId,
        gameId: null,
        commandId: null,
        event: repaired ? 'night.rail-repaired' : 'night.rail-viewed',
        outcome: 'success',
        durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
        data: {
          night_id: nightId,
          board_count: result.activeBoards.length,
          result_count: result.recentResults.length,
          presence_count: result.presenceCount,
        },
      });
    } catch {
      // Diagnostics never hide a successful rail read.
    }
    return result;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();
const clock = new SystemClock();

/** [BM-038] Web composition for the House-scoped Night rail query. */
export function getNightRail(
  request: Request,
  houseId: string,
  nightId: string,
): Promise<NightRailSnapshot | null> {
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
  return createNightRailReader({
    getViewer,
    readNightRail: (query) =>
      readNightRailUseCase(query, {
        authorizeHouseAction,
        rails: new PgNightRailRepository(database),
      }),
    logger: getLogger(),
    metrics: getRealtimeMetrics(),
    clock,
  })(request, houseId, nightId);
}
