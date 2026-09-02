import {
  ChessJsRulesAdapter,
  CryptoGameSeatColorChooser,
  SystemClock,
  generateUuidV7,
} from '@between-moves/adapters';
import {
  acceptGameSeat,
  createAuthorizeHouseAction,
  createGameSeat,
  submitMove,
} from '@between-moves/application';
import {
  PgGameSeatAcceptanceRepository,
  PgGameSeatRepository,
  PgHouseAuthorizationMembershipRepository,
  PgSubmitMoveRepository,
} from '@between-moves/db';
import type {
  GameSeatAcceptanceDependencies,
  GameSeatCreationDependencies,
  SubmitMoveDependencies,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../config';
import { getDatabase } from './database';
import type { GameSeatCommandHandlerDependencies } from './game-seat-command-handler';
import type { GameSeatAcceptanceHandlerDependencies } from './game-seat-acceptance-handler';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getLogger } from './logger';
import { getMoveMetrics, getMoveRateLimit } from './rate-limit';
import type { SubmitMoveHandlerDependencies } from './submit-move-handler';
import { requireViewer } from './viewer';

const clock = new SystemClock();
const colors = new CryptoGameSeatColorChooser();
const rules = new ChessJsRulesAdapter();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function requestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function dependencies(request: Request): GameSeatCreationDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: requestId(request),
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    colors,
    seats: new PgGameSeatRepository(database),
  };
}

function acceptanceDependencies(request: Request): GameSeatAcceptanceDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: requestId(request),
      }),
    }),
    clock,
    acceptances: new PgGameSeatAcceptanceRepository(database),
  };
}

function moveDependencies(request: Request): SubmitMoveDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: requestId(request),
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    rules,
    moves: new PgSubmitMoveRepository(database),
  };
}

/** [BM-022] Web composition for correspondence seat creation. */
export function gameSeatCommandHandlerDependencies(
  request: Request,
): GameSeatCommandHandlerDependencies {
  const seatDependencies = dependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    createGameSeat: (command) => createGameSeat(command, seatDependencies),
    logger: getLogger(),
    clock,
  };
}

/** [BM-023] Web composition for Open-seat acceptance. */
export function gameSeatAcceptanceHandlerDependencies(
  request: Request,
): GameSeatAcceptanceHandlerDependencies {
  const seatDependencies = acceptanceDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    acceptGameSeat: (command) => acceptGameSeat(command, seatDependencies),
    logger: getLogger(),
    clock,
  };
}

/** [BM-024] Web composition for the sole durable Move command. */
export function submitMoveHandlerDependencies(request: Request): SubmitMoveHandlerDependencies {
  const dependencies = moveDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    limitMove: getMoveRateLimit(),
    submitMove: (command) => submitMove(command, dependencies),
    logger: getLogger(),
    metrics: getMoveMetrics(),
    clock,
  };
}
