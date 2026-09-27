import { drawGameBodySchema, resignGameBodySchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  MoveConflictError,
  type AuthenticatedViewer,
  type DrawGameRequest,
  type GameLifecycleResult,
  type ResignGameRequest,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem, readJsonBody, readRequestId } from '../kernel/request';
import { recordGameCompleted, recordGameCompletionRejected } from './game-completion-observability';

const MAXIMUM_BODY_BYTES = 1_024;
const identifierSchema = z.string().uuid();

export interface GameCompletionHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly resignGame: (request: ResignGameRequest) => Promise<GameLifecycleResult>;
  readonly handleDraw: (request: DrawGameRequest) => Promise<GameLifecycleResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'Game command is invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function commandError(request: Request, error: unknown): Response | null {
  if (error instanceof MoveConflictError) {
    return problem(request, 409, 'move_conflict', 'Game conflict', error.message, {
      meta: {
        version: error.current.version,
        currentPly: error.current.currentPly,
        fen: error.current.fen,
      },
    });
  }
  if (
    error instanceof HouseAuthorizationDeniedError ||
    (error instanceof DomainError && error.code === 'authorization_denied')
  ) {
    return problem(
      request,
      403,
      'forbidden',
      'Forbidden',
      'Only a seated Member can change this Game result.',
    );
  }
  if (!(error instanceof DomainError)) return null;
  if (error.code === 'not_found') {
    return problem(request, 404, 'not_found', 'Not found', 'The Game is unavailable.');
  }
  if (error.code === 'conflict') {
    return problem(request, 409, 'game_conflict', 'Game conflict', error.message);
  }
  return null;
}

function response(result: GameLifecycleResult): Response {
  return Response.json(
    {
      state: result.state,
      result: result.result,
      resultReason: result.resultReason,
      completedAt: result.completedAt?.toISOString() ?? null,
      pendingDrawOffer: result.pendingDrawOffer,
    },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

async function authorizeRequest(
  request: Request,
  houseId: string,
  gameId: string,
  dependencies: GameCompletionHandlerDependencies,
): Promise<{ viewer: AuthenticatedViewer } | Response> {
  if (request.headers.get('origin') !== dependencies.expectedOrigin) {
    return problem(
      request,
      403,
      'origin_rejected',
      'Origin rejected',
      'Request origin is not allowed.',
    );
  }
  if (!identifierSchema.safeParse(houseId).success || !identifierSchema.safeParse(gameId).success) {
    return validationProblem(request, 'Game route is invalid.');
  }
  try {
    return { viewer: await dependencies.requireViewer(request) };
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    return problem(
      request,
      401,
      'unauthenticated',
      'Authentication required',
      'Sign in to continue.',
    );
  }
}

async function body(request: Request): Promise<unknown | Response> {
  const parsed = await readJsonBody(request, MAXIMUM_BODY_BYTES);
  if (parsed.kind === 'too_large') {
    return problem(
      request,
      413,
      'payload_too_large',
      'Payload too large',
      'Game command is too large.',
    );
  }
  return parsed.kind === 'invalid' ? validationProblem(request) : parsed.value;
}

/** [BM-028] House-scoped resignation boundary. */
export function createResignGameHandler(dependencies: GameCompletionHandlerDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    const authorized = await authorizeRequest(request, houseId, gameId, dependencies);
    if (authorized instanceof Response) return authorized;
    const requestBody = await body(request);
    if (requestBody instanceof Response) return requestBody;
    const parsed = resignGameBodySchema.safeParse(requestBody);
    if (!parsed.success) return validationProblem(request);
    try {
      const result = await dependencies.resignGame({
        houseId,
        gameId,
        clientCommandId: parsed.data.clientCommandId,
        viewer: authorized.viewer,
      });
      recordGameCompleted(
        dependencies,
        {
          requestId: readRequestId(request),
          viewer: authorized.viewer,
          houseId,
          gameId,
          commandId: parsed.data.clientCommandId,
          source: 'resign',
          startedAt,
        },
        result,
      );
      return response(result);
    } catch (error) {
      const failure = commandError(request, error);
      if (failure !== null && error instanceof DomainError) {
        recordGameCompletionRejected(
          dependencies,
          {
            requestId: readRequestId(request),
            viewer: authorized.viewer,
            houseId,
            gameId,
            commandId: parsed.data.clientCommandId,
            source: 'resign',
            startedAt,
          },
          error,
        );
        return failure;
      }
      throw error;
    }
  };
}

/** [BM-028] [DR-DRAW-01/02] House-scoped draw offer/acceptance boundary. */
export function createDrawGameHandler(dependencies: GameCompletionHandlerDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    const authorized = await authorizeRequest(request, houseId, gameId, dependencies);
    if (authorized instanceof Response) return authorized;
    const requestBody = await body(request);
    if (requestBody instanceof Response) return requestBody;
    const parsed = drawGameBodySchema.safeParse(requestBody);
    if (!parsed.success) return validationProblem(request);
    try {
      const result = await dependencies.handleDraw({
        houseId,
        gameId,
        action: parsed.data.action,
        clientCommandId: parsed.data.clientCommandId,
        viewer: authorized.viewer,
      });
      recordGameCompleted(
        dependencies,
        {
          requestId: readRequestId(request),
          viewer: authorized.viewer,
          houseId,
          gameId,
          commandId: parsed.data.clientCommandId,
          source: 'draw',
          startedAt,
        },
        result,
      );
      return response(result);
    } catch (error) {
      const failure = commandError(request, error);
      if (failure !== null && error instanceof DomainError) {
        recordGameCompletionRejected(
          dependencies,
          {
            requestId: readRequestId(request),
            viewer: authorized.viewer,
            houseId,
            gameId,
            commandId: parsed.data.clientCommandId,
            source: 'draw',
            startedAt,
          },
          error,
        );
        return failure;
      }
      throw error;
    }
  };
}
