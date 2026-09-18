import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  deleteHouseChat,
  postHouseChat,
  readHouseChat,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgHouseChatRepository } from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type DeleteHouseChatDependencies,
  type HouseChatSnapshot,
  type PostHouseChatDependencies,
  type ReadHouseChatDependencies,
  type Viewer,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  type StructuredLogger,
} from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import type {
  HouseChatHandlerDependencies,
  HouseChatReader,
} from '../../server/house-chat-handler';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getChatMetrics, getChatRateLimit } from '../../server/rate-limit';
import { getViewer, requireViewer } from '../../server/viewer';
export { parseHouseChatSnapshot, serializeHouseChatSnapshot } from './chat-snapshot';

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

function writeDependencies(
  request: Request,
): PostHouseChatDependencies & DeleteHouseChatDependencies {
  return {
    authorizeHouseAction: authorization(request),
    chat: new PgHouseChatRepository(getDatabase().pool),
    clock,
    ids: { generate: () => generateUuidV7() },
  };
}

function readDependencies(request: Request): ReadHouseChatDependencies {
  return {
    authorizeHouseAction: authorization(request),
    chat: new PgHouseChatRepository(getDatabase().pool),
  };
}

export interface HouseChatReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readHouseChat: (query: {
    readonly houseId: string;
    readonly nightId: string;
    readonly viewer: Viewer;
  }) => Promise<HouseChatSnapshot | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

/** [BM-040] Hide unauthorized chat and log reconnects without chat bodies. */
export function createHouseChatReader(dependencies: HouseChatReaderDependencies): HouseChatReader {
  return async (request, houseId, nightId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let result: HouseChatSnapshot | null;
    try {
      result = await dependencies.readHouseChat({ houseId, nightId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (result === null) return null;
    const repaired = new URL(request.url).searchParams.get('repair') === '1';
    try {
      dependencies.logger.log({
        level: 'info',
        requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
        actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
        houseId,
        gameId: null,
        commandId: null,
        event: repaired ? 'night.chat-repaired' : 'night.chat-viewed',
        outcome: 'success',
        durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
        data: {
          night_id: nightId,
          message_count: result.messages.length,
          chat_sequence: result.chatSequence.toString(),
        },
      });
    } catch {
      // Diagnostics never hide a successful chat read.
    }
    return result;
  };
}

/** [BM-040] Compose the House-chat command at the web boundary. */
export function houseChatHandlerDependencies(request: Request): HouseChatHandlerDependencies {
  const dependencies = writeDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    limitChat: getChatRateLimit(),
    postHouseChat: (command) => postHouseChat(command, dependencies),
    deleteHouseChat: (command) => deleteHouseChat(command, dependencies),
    logger: getLogger(),
    metrics: getChatMetrics(),
    clock,
  };
}

/** [BM-040] Read recent durable House chat for the Night gathering. */
export async function getHouseChat(
  request: Request,
  houseId: string,
  nightId: string,
): Promise<HouseChatSnapshot | null> {
  return createHouseChatReader({
    getViewer,
    readHouseChat: (query) => readHouseChat(query, readDependencies(request)),
    logger: getLogger(),
    clock,
  })(request, houseId, nightId);
}
