import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type InvitationRevocationResult,
  type RevokeInvitationRequest,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import { problemResponse as problem } from '../../../../../../../kernel/request';

const routeParametersSchema = z.object({
  houseId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export interface RevokeInvitationRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly revokeInvitation: (
    request: RevokeInvitationRequest,
  ) => Promise<InvitationRevocationResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

/** [BM-014] Authenticated and origin-checked Invitation revocation seam. */
export function createRevokeInvitationRequestHandler(
  dependencies: RevokeInvitationRequestHandlerDependencies,
) {
  return async (request: Request, houseId: string, invitationId: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (!routeParametersSchema.safeParse({ houseId, invitationId }).success) {
      return problem(
        request,
        422,
        'validation_failed',
        'Validation failed',
        'House or Invitation ID is invalid.',
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
        'Sign in to revoke an Invitation.',
      );
    }

    let result: InvitationRevocationResult;
    try {
      result = await dependencies.revokeInvitation({ houseId, invitationId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) {
        return problem(
          request,
          403,
          'forbidden',
          'Forbidden',
          'You cannot revoke an Invitation for this House.',
        );
      }
      if (error instanceof DomainError && error.code === 'not_found') {
        return problem(request, 404, 'not_found', 'Not found', 'Invitation is unavailable.');
      }
      throw error;
    }

    dependencies.logger.log({
      level: 'info',
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
      actorId: viewer.userId,
      houseId,
      gameId: null,
      commandId: request.headers.get('idempotency-key'),
      event: 'house.invitation-revoked',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
      data: { invitation_id: invitationId, revoked_now: result.revokedNow },
    });
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  };
}
