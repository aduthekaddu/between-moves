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
  handleDraw,
  resignGame,
  submitMove,
} from '@between-moves/application';
import {
  PgGameSeatAcceptanceRepository,
  PgGameSeatRepository,
  PgGameCompletionRepository,
  PgHouseAuthorizationMembershipRepository,
  PgSubmitMoveRepository,
} from '@between-moves/db';
import type {
  GameSeatAcceptanceDependencies,
  GameSeatCreationDependencies,
  GameCompletionDependencies,
  SubmitMoveDependencies,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../config';
import { getDatabase } from './database';
import type { GameSeatCommandHandlerDependencies } from './game-seat-command-handler';
import type { GameSeatAcceptanceHandlerDependencies } from './game-seat-acceptance-handler';
import type { GameCompletionHandlerDependencies } from './game-completion-handler';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getLogger } from './logger';
import { getMoveMetrics, getMoveRateLimit } from './rate-limit';
import type { SubmitMoveHandlerDependencies } from './submit-move-handler';
import { requireViewer } from './viewer';
import { readRequestId } from '../kernel/request';

const clock = new SystemClock();
const colors = new CryptoGameSeatColorChooser();
const rules = new ChessJsRulesAdapter();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function dependencies(request: Request): GameSeatCreationDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: readRequestId(request),
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
        requestId: readRequestId(request),
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
        requestId: readRequestId(request),
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    rules,
    moves: new PgSubmitMoveRepository(database),
  };
}

function completionDependencies(request: Request): GameCompletionDependencies {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: readRequestId(request),
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    completions: new PgGameCompletionRepository(database),
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

/** [BM-028] Web composition for resignation and draw completion commands. */
export function gameCompletionHandlerDependencies(
  request: Request,
): GameCompletionHandlerDependencies {
  const dependencies = completionDependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    resignGame: (command) => resignGame(command, dependencies),
    handleDraw: (command) => handleDraw(command, dependencies),
    logger: getLogger(),
    clock,
  };
}
