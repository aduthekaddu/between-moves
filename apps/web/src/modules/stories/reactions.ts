import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readCurrentGameReaction,
  setGameReaction,
} from '@between-moves/application';
import {
  PgGameReactionRepository,
  PgHouseAuthorizationMembershipRepository,
} from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type GameReactionValue,
  type ReadGameReactionDependencies,
  type SetGameReactionDependencies,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import type { GameReactionHandlerDependencies } from '../../server/game-reaction-handler';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getReactionMetrics, getReactionRateLimit } from '../../server/rate-limit';
import { getViewer, requireViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function authorization(request: Request) {
  const database = getDatabase().pool;
  return createAuthorizeHouseAction({
    memberships: new PgHouseAuthorizationMembershipRepository(database),
    nightHosts: { isAssignedNightHost: async () => false },
    denials: createHouseAuthorizationDenialRecorder({
      logger: getLogger(),
      metrics: authorizationMetrics,
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
    }),
  });
}

function writeDependencies(request: Request): SetGameReactionDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: authorization(request),
    reactions: new PgGameReactionRepository(database),
    clock,
    ids: { generate: () => generateUuidV7() },
  };
}

function readDependencies(request: Request): ReadGameReactionDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: authorization(request),
    reactions: new PgGameReactionRepository(database),
  };
}

/** [BM-031] Compose the Reaction command at the web boundary. */
export function gameReactionHandlerDependencies(request: Request): GameReactionHandlerDependencies {
  const dependencies = writeDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    limitReaction: getReactionRateLimit(),
    setGameReaction: (command) => setGameReaction(command, dependencies),
    logger: getLogger(),
    metrics: getReactionMetrics(),
    clock,
  };
}

/** [BM-031] Read the current Member's selected Reaction for the completed-Game UI. */
export async function getCurrentGameReaction(
  request: Request,
  houseId: string,
  gameId: string,
): Promise<GameReactionValue | null> {
  const viewer = await getViewer(request);
  try {
    return await readCurrentGameReaction({ houseId, gameId, viewer }, readDependencies(request));
  } catch (error) {
    if (error instanceof HouseAuthorizationDeniedError) return null;
    throw error;
  }
}
