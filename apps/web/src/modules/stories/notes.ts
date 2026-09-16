import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readGameNotes,
  saveGameNote,
} from '@between-moves/application';
import { PgGameNoteRepository, PgHouseAuthorizationMembershipRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type GameNotesView,
  type ReadGameNotesDependencies,
  type SaveGameNoteDependencies,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import type { GameNoteHandlerDependencies } from '../../server/game-note-handler';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getNoteMetrics, getNoteRateLimit } from '../../server/rate-limit';
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

function writeDependencies(request: Request): SaveGameNoteDependencies {
  return {
    authorizeHouseAction: authorization(request),
    notes: new PgGameNoteRepository(getDatabase().pool),
    clock,
    ids: { generate: () => generateUuidV7() },
  };
}

function readDependencies(request: Request): ReadGameNotesDependencies {
  return {
    authorizeHouseAction: authorization(request),
    notes: new PgGameNoteRepository(getDatabase().pool),
  };
}

/** [BM-032] Compose the Game-note command at the web boundary. */
export function gameNoteHandlerDependencies(request: Request): GameNoteHandlerDependencies {
  const dependencies = writeDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    limitNote: getNoteRateLimit(),
    saveGameNote: (command) => saveGameNote(command, dependencies),
    logger: getLogger(),
    metrics: getNoteMetrics(),
    clock,
  };
}

/** [BM-032] Read completed-Game notes for the House story surface. */
export async function getGameNotes(
  request: Request,
  houseId: string,
  gameId: string,
): Promise<GameNotesView | null> {
  const viewer = await getViewer(request);
  try {
    return await readGameNotes({ houseId, gameId, viewer }, readDependencies(request));
  } catch (error) {
    if (error instanceof HouseAuthorizationDeniedError) return null;
    throw error;
  }
}
