import type {
  AuthenticatedViewer,
  CharterDraftResult,
  DraftSeasonCharterRequest,
  DraftSeasonRequest,
  PublishSeasonRequest,
  SeasonDraftResult,
  SeasonPublishResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import {
  charterBodySchema,
  draftSeasonBodySchema,
  parseSeasonBody,
  publishSeasonBodySchema,
  readSeasonRequestId,
  resolveSeasonBoundary,
  seasonCommandError,
  seasonIdempotencyKeySchema,
  validationProblem,
} from './season-command-boundary';

export interface SeasonCommandHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly draftSeason: (request: DraftSeasonRequest) => Promise<SeasonDraftResult>;
  readonly draftSeasonCharter: (request: DraftSeasonCharterRequest) => Promise<CharterDraftResult>;
  readonly publishSeason: (request: PublishSeasonRequest) => Promise<SeasonPublishResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

const privateHeaders = { 'Cache-Control': 'private, no-store' } as const;

function logPublishedSeason(
  dependencies: SeasonCommandHandlerDependencies,
  request: Request,
  input: {
    readonly actorId: string;
    readonly houseId: string;
    readonly seasonId: string;
    readonly charterVersion: number;
    readonly actorMembershipId: string;
    readonly startedAt: Date;
  },
): void {
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: readSeasonRequestId(request),
      actorId: input.actorId,
      houseId: input.houseId,
      gameId: null,
      commandId: null,
      event: 'bm.season.published',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - input.startedAt.getTime()),
      data: {
        season_id: input.seasonId,
        charter_version: input.charterVersion,
        actor_membership_id: input.actorMembershipId,
      },
    });
  } catch {
    // A committed Season remains published when the diagnostic sink is unavailable.
  }
}

/** [BM-019] [PR-JRN-03] Create the House-scoped draft that will own Charter versions. */
export function createDraftSeasonHandler(dependencies: SeasonCommandHandlerDependencies) {
  return async (request: Request, houseId: string): Promise<Response> => {
    const boundary = await resolveSeasonBoundary(dependencies, request, houseId);
    if (boundary.kind === 'response') return boundary.response;
    const body = await parseSeasonBody(request, draftSeasonBodySchema);
    if (body.kind === 'response') return body.response;
    const idempotencyKey = seasonIdempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!idempotencyKey.success) {
      return validationProblem(request, {
        'Idempotency-Key': ['A valid Idempotency-Key header is required.'],
      });
    }
    try {
      const result = await dependencies.draftSeason({
        houseId,
        title: body.data.title ?? 'Untitled Season',
        idempotencyKey: idempotencyKey.data,
        viewer: boundary.viewer,
      });
      return Response.json(
        { seasonId: result.seasonId, state: result.state },
        { status: 201, headers: privateHeaders },
      );
    } catch (error) {
      const response = seasonCommandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-019] [DR-SEASON-02/03] Persist the next validated immutable Charter version. */
export function createDraftSeasonCharterHandler(dependencies: SeasonCommandHandlerDependencies) {
  return async (request: Request, houseId: string, seasonId: string): Promise<Response> => {
    const boundary = await resolveSeasonBoundary(dependencies, request, houseId, seasonId);
    if (boundary.kind === 'response') return boundary.response;
    const body = await parseSeasonBody(request, charterBodySchema);
    if (body.kind === 'response') return body.response;
    try {
      const result = await dependencies.draftSeasonCharter({
        houseId,
        seasonId,
        correspondencePaceHours: body.data.correspondencePaceHours,
        nightRecurrence: body.data.nightRecurrence,
        viewer: boundary.viewer,
      });
      return Response.json(result, { headers: privateHeaders });
    } catch (error) {
      const response = seasonCommandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}

/** [BM-019] [AE-06] Atomically publish the latest Charter and report activation. */
export function createPublishSeasonHandler(dependencies: SeasonCommandHandlerDependencies) {
  return async (request: Request, houseId: string, seasonId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    const boundary = await resolveSeasonBoundary(dependencies, request, houseId, seasonId);
    if (boundary.kind === 'response') return boundary.response;
    const body = await parseSeasonBody(request, publishSeasonBodySchema);
    if (body.kind === 'response') return body.response;
    try {
      const result = await dependencies.publishSeason({
        houseId,
        seasonId,
        title: body.data.title,
        startsAt: new Date(body.data.startsAt),
        endsAt: new Date(body.data.endsAt),
        viewer: boundary.viewer,
      });
      if (result.activatedNow) {
        logPublishedSeason(dependencies, request, {
          actorId: boundary.viewer.userId,
          houseId,
          seasonId: result.seasonId,
          charterVersion: result.publishedCharterVersion,
          actorMembershipId: result.actorMembershipId,
          startedAt,
        });
      }
      return Response.json(
        {
          seasonId: result.seasonId,
          state: result.state,
          publishedCharterVersion: result.publishedCharterVersion,
        },
        { headers: privateHeaders },
      );
    } catch (error) {
      const response = seasonCommandError(request, error);
      if (response !== null) return response;
      throw error;
    }
  };
}
