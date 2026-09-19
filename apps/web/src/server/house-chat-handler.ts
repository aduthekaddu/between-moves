import { houseChatBodySchema, houseChatSnapshotSchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type DeleteHouseChatRequest,
  type HouseChatMessage,
  type HouseChatSnapshot,
  type PostHouseChatRequest,
} from '@between-moves/domain';
import type { ChatMetricStubs, StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { ChatRateLimit } from '../kernel/chat-rate-limit';
import { problemResponse as problem, readJsonBody } from '../kernel/request';
import { serializeHouseChatSnapshot } from '../modules/nights/chat-snapshot';

export type HouseChatReader = (
  request: Request,
  houseId: string,
  nightId: string,
) => Promise<HouseChatSnapshot | null>;

const MAXIMUM_BODY_BYTES = 16_384;
const identifierSchema = z.string().uuid();

export interface HouseChatHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly limitChat: ChatRateLimit;
  readonly postHouseChat: (request: PostHouseChatRequest) => Promise<HouseChatMessage>;
  readonly deleteHouseChat: (request: DeleteHouseChatRequest) => Promise<void>;
  readonly logger: StructuredLogger;
  readonly metrics: ChatMetricStubs;
  readonly clock: { now(): Date };
}

function validationProblem(request: Request, detail = 'House chat details are invalid.'): Response {
  return problem(request, 422, 'validation_failed', 'Validation failed', detail);
}

function serializeMessage(message: HouseChatMessage) {
  return {
    id: message.id,
    membershipId: message.membershipId,
    authorDisplayName: message.authorDisplayName,
    body: message.body,
    sequence: message.sequence.toString(),
    createdAt: message.createdAt.toISOString(),
  };
}

function originRejected(request: Request): Response {
  return problem(
    request,
    403,
    'origin_rejected',
    'Origin rejected',
    'Request origin is not allowed.',
  );
}

/** [BM-040] House-scoped POST boundary for durable-first Night chat. */
export function createPostHouseChatHandler(dependencies: HouseChatHandlerDependencies) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return originRejected(request);
    }
    if (
      !identifierSchema.safeParse(houseId).success ||
      !identifierSchema.safeParse(nightId).success
    ) {
      return validationProblem(request, 'Night route is invalid.');
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
        'Sign in to send House chat.',
      );
    }
    const rateLimit = await dependencies.limitChat(request, viewer.userId);
    if (!rateLimit.allowed) {
      return problem(
        request,
        429,
        'rate_limited',
        'Too many chat messages',
        'Try sending your message again shortly.',
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
        'House chat details are too large.',
      );
    }
    if (body.kind === 'invalid') return validationProblem(request);
    const parsed = houseChatBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return validationProblem(request, 'House chat must be 1–2000 characters.');
    }

    try {
      const result = await dependencies.postHouseChat({
        houseId,
        nightId,
        body: parsed.data.body,
        viewer,
      });
      try {
        dependencies.metrics.incrementChatSend();
      } catch {
        // A committed message remains successful when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
          actorId: viewer.userId,
          houseId,
          gameId: null,
          commandId: null,
          event: 'night.chat-posted',
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: {
            night_id: nightId,
            message_id: result.id,
            actor_membership_id: result.membershipId,
          },
        });
      } catch {
        // A committed message remains successful when diagnostics are unavailable.
      }
      return Response.json(serializeMessage(result), {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only active House Members can send House chat.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(request, 404, 'not_found', 'Not found', 'House chat is unavailable.');
      }
      if (error instanceof DomainError && error.code === 'validation_failed') {
        return validationProblem(request, error.message);
      }
      throw error;
    }
  };
}

/** [BM-040] HTTP boundary for the recent durable House chat snapshot. */
export function createReadHouseChatHandler(dependencies: {
  readonly readHouseChat: HouseChatReader;
}) {
  return async (request: Request, houseId: string, nightId: string): Promise<Response> => {
    if (
      !identifierSchema.safeParse(houseId).success ||
      !identifierSchema.safeParse(nightId).success
    ) {
      return validationProblem(request, 'Night route is invalid.');
    }
    const snapshot: HouseChatSnapshot | null = await dependencies.readHouseChat(
      request,
      houseId,
      nightId,
    );
    if (snapshot === null) {
      return problem(request, 404, 'not_found', 'Not found', 'House chat is unavailable.');
    }
    return Response.json(houseChatSnapshotSchema.parse(serializeHouseChatSnapshot(snapshot)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  };
}

/** [BM-040] Owner/steward soft-delete boundary for House chat. */
export function createDeleteHouseChatHandler(dependencies: HouseChatHandlerDependencies) {
  return async (
    request: Request,
    houseId: string,
    nightId: string,
    messageId: string,
  ): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return originRejected(request);
    }
    if (
      !identifierSchema.safeParse(houseId).success ||
      !identifierSchema.safeParse(nightId).success ||
      !identifierSchema.safeParse(messageId).success
    ) {
      return validationProblem(request, 'Night route is invalid.');
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
        'Sign in to moderate House chat.',
      );
    }

    try {
      await dependencies.deleteHouseChat({ houseId, nightId, messageId, viewer });
      try {
        dependencies.metrics.incrementChatDelete();
      } catch {
        // A committed delete remains successful when metrics are unavailable.
      }
      try {
        dependencies.logger.log({
          level: 'info',
          requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
          actorId: viewer.userId,
          houseId,
          gameId: null,
          commandId: null,
          event: 'night.chat-deleted',
          outcome: 'success',
          durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
          data: { night_id: nightId, message_id: messageId },
        });
      } catch {
        // A committed delete remains successful when diagnostics are unavailable.
      }
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'Only owners and stewards can remove House chat.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(
          request,
          404,
          'not_found',
          'Not found',
          'House chat message is unavailable.',
        );
      }
      throw error;
    }
  };
}
