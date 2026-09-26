import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  closeSeason as closeSeasonUseCase,
  createAuthorizeHouseAction,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgSeasonRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type CloseSeasonRequest,
  type SeasonCloseResult,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createSeasonTransitionRecorder,
  type StructuredLogger,
} from '@between-moves/observability';
import { problemResponse as problem } from '../../kernel/request';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import {
  readSeasonRequestId,
  resolveSeasonBoundary,
  seasonCommandError,
} from '../../server/season-command-boundary';
import { requireViewer } from '../../server/viewer';

export interface CloseSeasonHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly closeSeason: (request: CloseSeasonRequest) => Promise<SeasonCloseResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function logClosedSeason(
  dependencies: CloseSeasonHandlerDependencies,
  request: Request,
  actorId: string,
  result: SeasonCloseResult,
  startedAt: Date,
): void {
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: readSeasonRequestId(request),
      actorId,
      houseId: result.houseId,
      gameId: null,
      commandId: null,
      event: 'season.closed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: {
        season_id: result.seasonId,
        actor_membership_id: result.actorMembershipId,
        standings_count: result.standings.length,
      },
    });
  } catch {
    // A committed close remains final when the diagnostic sink is unavailable.
  }
}

/** [BM-047] POST /api/houses/{houseId}/seasons/{seasonId}/close. */
export function createCloseSeasonHandler(dependencies: CloseSeasonHandlerDependencies) {
  return async (request: Request, houseId: string, seasonId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    const boundary = await resolveSeasonBoundary(dependencies, request, houseId, seasonId);
    if (boundary.kind === 'response') return boundary.response;
    try {
      const result = await dependencies.closeSeason({
        houseId,
        seasonId,
        viewer: boundary.viewer,
      });
      if (result.closedNow) {
        logClosedSeason(dependencies, request, boundary.viewer.userId, result, startedAt);
      }
      return Response.json(
        {
          seasonId: result.seasonId,
          state: result.state,
          closedAt: result.closedAt.toISOString(),
          standings: result.standings,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only an Owner or Steward can close a Season.',
        );
      }
      const response = seasonCommandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

/** [BM-047] Web composition for the Owner/Steward Season close command. */
export function closeSeasonHandlerDependencies(request: Request): CloseSeasonHandlerDependencies {
  const database = getDatabase().pool;
  const requestId = readSeasonRequestId(request);
  const dependencies = {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId,
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    seasons: new PgSeasonRepository(database),
    transitions: createSeasonTransitionRecorder({ logger: getLogger(), requestId }),
  };
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    closeSeason: (command) => closeSeasonUseCase(command, dependencies),
    logger: getLogger(),
    clock,
  };
}
