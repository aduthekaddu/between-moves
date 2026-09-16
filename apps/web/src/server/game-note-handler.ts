import { gameNoteBodySchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type GameNote,
  type SaveGameNoteRequest,
} from '@between-moves/domain';
import type { NoteMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { NoteRateLimit } from '../kernel/note-rate-limit';
import { problemResponse as problem, readJsonBody } from '../kernel/request';

const MAXIMUM_BODY_BYTES = 16_384;
const identifierSchema = z.string().uuid();

export interface GameNoteHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitNote: NoteRateLimit;
  readonly saveGameNote: (request: SaveGameNoteRequest) => Promise<GameNote>;
  readonly logger: StructuredLogger;
  readonly metrics: NoteMetricStubs;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'Game note details are invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

/** [BM-032] House-scoped POST boundary for create/edit of one Game note. */
export function createGameNoteHandler(dependencies: GameNoteHandlerDependencies) {
  return async (request: Request, houseId: string, gameId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
    }
    if (
      !identifierSchema.safeParse(houseId).success ||
      !identifierSchema.safeParse(gameId).success
    ) {
      return validationProblem(request, 'Game route is invalid.');
    }

    let viewer: AuthenticatedViewer;
    try {
      viewer = await dependencies.requireViewer(request);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      return problem(
        request,
        401,
        'unauthenticated',
        'Authentication required',
        'Sign in to leave a Game note.',
      );
    }
    const rateLimit = await dependencies.limitNote(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many Game notes',
        'Try saving your Game note again shortly.',
        { headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
    if (body.kind === 'too_large') {
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Game note details are too large.',
      );
    }
    if (body.kind === 'invalid') return validationProblem(request);
    const parsed = gameNoteBodySchema.safeParse(body.value);
    if (!parsed.success) return validationProblem(request, 'Game notes must be 1–2000 characters.');

    try {
      const result = await dependencies.saveGameNote({
        houseId,
        gameId,
        body: parsed.data.body,
        viewer,
      });
      try {
        dependencies.metrics.incrementNoteSave();
      } catch {
        // A committed note remains successful when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
          actorId: viewer.userId,
          houseId,
          gameId,
          commandId: null,
          event: result.editedAt === null ? 'bm.note.created' : 'game.note-saved',
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: {
            actor_membership_id: result.membershipId,
            edited: result.editedAt !== null,
          },
        });
      } catch {
        // A committed note remains successful when diagnostics are unavailable.
      }
      return Response.json(
        {
          membershipId: result.membershipId,
          authorDisplayName: result.authorDisplayName,
          body: result.body,
          createdAt: result.createdAt.toISOString(),
          editedAt: result.editedAt?.toISOString() ?? null,
        },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can leave Game notes.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(
          request,
          404,
          'not_found',
          'Not found',
          'The completed Game is unavailable.',
        );
      }
      if (error instanceof DomainError && error.code === 'validation_failed') {
        return validationProblem(request, error.message);
      }
      throw error;
    }
  };
}
