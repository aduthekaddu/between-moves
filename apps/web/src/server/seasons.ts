import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  draftSeason as draftSeasonUseCase,
  draftSeasonCharter as draftSeasonCharterUseCase,
  publishSeason as publishSeasonUseCase,
  readHouseSeason as readHouseSeasonUseCase,
  readLastClosedSeason as readLastClosedSeasonUseCase,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgSeasonRepository } from '@between-moves/db';
import type {
  ClosedSeasonView,
  HouseSeasonView,
  ReadHouseSeasonRequest,
  SeasonDependencies,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createSeasonTransitionRecorder,
} from '@between-moves/observability';
import { getConfig } from '../config';
import { getDatabase } from './database';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getLogger } from './logger';
import { readRequestId } from '../kernel/request';
import type { SeasonCommandHandlerDependencies } from './season-command-handler';
import { getViewer, requireViewer } from './viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function seasonDependencies(requestId: string): SeasonDependencies {
  const database = getDatabase().pool;
  return {
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
}

/** [BM-019] Web composition for all three Charter publication commands. */
export function seasonCommandHandlerDependencies(
  request: Request,
): SeasonCommandHandlerDependencies {
  const requestId = readRequestId(request);
  const dependencies = seasonDependencies(requestId);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    draftSeason: (command) => draftSeasonUseCase(command, dependencies),
    draftSeasonCharter: (command) => draftSeasonCharterUseCase(command, dependencies),
    publishSeason: (command) => publishSeasonUseCase(command, dependencies),
    logger: getLogger(),
    clock,
  };
}

/** [BM-019] Member-scoped current Season read for the Charter page. */
export async function getHouseSeason(
  request: Request,
  houseId: string,
): Promise<HouseSeasonView | null> {
  const requestId = readRequestId(request);
  const dependencies = seasonDependencies(requestId);
  const query: ReadHouseSeasonRequest = { houseId, viewer: await getViewer(request) };
  return readHouseSeasonUseCase(query, {
    authorizeHouseAction: dependencies.authorizeHouseAction,
    seasons: new PgSeasonRepository(getDatabase().pool),
  });
}

/**
 * [BM-047] Member-scoped frozen standings for a closing Season or the most recently closed one.
 * Return null when the repository finds no available closed Season; viewer resolution,
 * authorization, and database failures propagate.
 */
export async function getLastClosedSeason(
  request: Request,
  houseId: string,
): Promise<ClosedSeasonView | null> {
  const dependencies = seasonDependencies(readRequestId(request));
  return readLastClosedSeasonUseCase(
    { houseId, viewer: await getViewer(request) },
    {
      authorizeHouseAction: dependencies.authorizeHouseAction,
      seasons: new PgSeasonRepository(getDatabase().pool),
    },
  );
}
