import {
  AuthenticationRequiredError,
  InvitationRedemptionError,
  type AuthenticatedViewer,
  type InvitationRedemptionResult,
  type RedeemInvitationRequest,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { z } from 'zod';
import type { InvitationRateLimit } from '../../../../../kernel/invitation-rate-limit';
import { problemResponse as problem, readRequestId } from '../../../../../kernel/request';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const problemInstance = '/api/invitations/[token]/redeem';

export interface RedeemInvitationRequestHandlerDependencies {
  readonly expectedOrigin: string;
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly rateLimit: InvitationRateLimit;
  readonly redeemInvitation: (
    request: RedeemInvitationRequest,
  ) => Promise<InvitationRedemptionResult>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

function invitationUnavailable(request: Request): Response {
  return problem(
    request,
    410,
    'invite_invalid',
    'Invitation unavailable',
    'This Invitation cannot be used.',
    { instance: problemInstance },
  );
}

/** [BM-016] [DR-INVITE-07..13] Authenticated Invitation redemption HTTP seam. */
export function createRedeemInvitationRequestHandler(
  dependencies: RedeemInvitationRequestHandlerDependencies,
) {
  return async (request: Request, token: string): Promise<Response> => {
    const startedAt = dependencies.clock.now();
    if (request.headers.get('origin') !== dependencies.expectedOrigin) {
      return problem(
        request,
        403,
        'origin_rejected',
        'Origin rejected',
        'Request origin is not allowed.',
        { instance: problemInstance },
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
        'Sign in to redeem this Invitation.',
        { instance: problemInstance },
      );
    }

    // [BM-051:AC-2] Over the redeem threshold: a fixed 429 problem with Retry-After, no account data.
    const limit = await dependencies.rateLimit(request, viewer.userId, 'redeem');
    if (!limit.allowed) {
      return problem(request, 429, 'rate_limited', 'Too many requests', 'Try again later.', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        instance: problemInstance,
      });
    }
    if (!tokenSchema.safeParse(token).success) return invitationUnavailable(request);

    try {
      const result = await dependencies.redeemInvitation({ token, viewer });
      dependencies.logger.log({
        level: 'info',
        requestId: readRequestId(request),
        actorId: viewer.userId,
        houseId: result.houseId,
        gameId: null,
        commandId: null,
        event: 'bm.invite.redeemed',
        outcome: 'success',
        durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
        data: {
          actor_membership_id: result.membershipId,
          invite_kind: result.inviteKind,
          membership_id: result.membershipId,
          reactivated: result.reactivated,
        },
      });
      return Response.json(
        { houseId: result.houseId, membershipId: result.membershipId },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch (error) {
      if (!(error instanceof InvitationRedemptionError)) throw error;
      if (error.failure === 'house_full') {
        return problem(
          request,
          403,
          'forbidden',
          'House is full',
          'This House is full. No more members can join right now.',
          { instance: problemInstance },
        );
      }
      return invitationUnavailable(request);
    }
  };
}
