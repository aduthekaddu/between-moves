import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type CreateInvitationRequest,
  type InvitationCreationResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { InvitationRateLimit } from '../../../../../kernel/invitation-rate-limit';
import { problemResponse as problem, readJsonBody } from '../../../../../kernel/request';

const houseIdSchema = z.string().uuid();
const MAXIMUM_BODY_BYTES = 4_096;
const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }).strict(),
  z.object({ kind: z.literal('single'), intendedEmail: z.string().trim().email() }).strict(),
]);
const idempotencyKeySchema = z.string().trim().min(1).max(128);

export interface CreateInvitationRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly rateLimit: InvitationRateLimit;
  readonly createInvitation: (
    request: CreateInvitationRequest,
  ) => Promise<InvitationCreationResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

/** [BM-014] Authenticated, origin-checked, rate-limited Invitation creation seam. */
export function createInvitationRequestHandler(
  dependencies: CreateInvitationRequestHandlerDependencies,
) {
  return async (request: Request, houseId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (!houseIdSchema.safeParse(houseId).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'House ID is invalid.',
      );
    }
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
      );
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
        'Sign in to create an Invitation.',
      );
    }

    // [BM-051:AC-2] Over the create threshold: a fixed 429 problem with Retry-After, no account data.
    const limit = await dependencies.rateLimit(request, viewer.userId, 'create');
    if (!limit.allowed) {
      return problem(request, 429, 'rate_limited', 'Too many requests', 'Try again later.', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      });
    }

    const body = await readJsonBody(request, MAXIMUM_BODY_BYTES);
    if (body.kind === 'too_large') {
      return problem(
        request,
        413,
        'payload_too_large',
        'Payload too large',
        'Invitation details exceed the request limit.',
      );
    }
    if (body.kind === 'invalid') {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Invitation details are invalid.',
      );
    }
    const parsed = bodySchema.safeParse(body.value);
    if (!parsed.success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Invitation details are invalid.',
      );
    }

    const rawIdempotencyKey = request.headers.get('idempotency-key');
    const parsedIdempotencyKey =
      rawIdempotencyKey === null ? null : idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (parsedIdempotencyKey !== null && !parsedIdempotencyKey.success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'Idempotency key is invalid.',
      );
    }
    const idempotencyKey = parsedIdempotencyKey === null ? null : parsedIdempotencyKey.data;

    let result: InvitationCreationResult;
    try {
      result = await dependencies.createInvitation({
        houseId,
        command: parsed.data,
        idempotencyKey,
        viewer,
      });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'You cannot create an Invitation for this House.',
        );
      }
      if (error instanceof DomainError && error.code === 'conflict') {
        return problem(
          request,
          409,
          'conflict',
          'Invitation unavailable',
          'This House cannot accept another Invitation.',
        );
      }
      if (error instanceof DomainError && error.code === 'idempotency_conflict') {
        return problem(
          request,
          409,
          'idempotency_conflict',
          'Idempotency conflict',
          'The Idempotency-Key was already used for another Invitation command.',
        );
      }
      throw error;
    }

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
      actorId: viewer.userId,
      houseId,
      gameId: null,
      commandId: idempotencyKey,
      event: 'house.invitation-created',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: {
        invitation_id: result.invitationId,
        kind: parsed.data.kind,
        use_limit: result.useLimit,
      },
    });

    return Response.json(
      { token: result.token, expiresAt: result.expiresAt.toISOString() },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  };
}
