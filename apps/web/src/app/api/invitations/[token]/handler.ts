import {
  AuthenticationRequiredError,
  type AuthenticatedViewer,
  type InspectInvitationRequest,
  type InvitationPreview,
} from '@between-moves/domain';
import { z } from 'zod';
import type { InvitationRateLimit } from '../../../../kernel/invitation-rate-limit';
import { problemResponse as problem } from '../../../../kernel/request';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const invitationProblemInstance = '/api/invitations/[token]';

export interface InspectInvitationRequestHandlerDependencies {
  readonly requireViewer: (request: Request) => Promise<AuthenticatedViewer>;
  readonly rateLimit: InvitationRateLimit;
  readonly inspectInvitation: (
    request: InspectInvitationRequest,
  ) => Promise<InvitationPreview | null>;
}

/** [BM-014] [DR-INVITE-13] Authenticated and rate-limited Invitation inspection seam. */
export function createInspectInvitationRequestHandler(
  dependencies: InspectInvitationRequestHandlerDependencies,
) {
  return async (request: Request, token: string): Promise<Response> => {
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
        'Sign in to inspect an Invitation.',
        { instance: invitationProblemInstance },
      );
    }

    // [BM-051:AC-2] Over the inspect threshold: a fixed 429 problem with Retry-After, no account data.
    const limit = await dependencies.rateLimit(request, viewer.userId, 'inspect');
    if (!limit.allowed) {
      return problem(request, 429, 'rate_limited', 'Too many requests', 'Try again later.', {
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        instance: invitationProblemInstance,
      });
    }
    if (!tokenSchema.safeParse(token).success) {
      return problem(
        request,
        410,
        'invite_invalid',
        'Invitation unavailable',
        'This Invitation cannot be used.',
        { instance: invitationProblemInstance },
      );
    }

    const preview = await dependencies.inspectInvitation({ token });
    if (preview === null) {
      return problem(
        request,
        410,
        'invite_invalid',
        'Invitation unavailable',
        'This Invitation cannot be used.',
        { instance: invitationProblemInstance },
      );
    }
    return Response.json(preview, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  };
}
