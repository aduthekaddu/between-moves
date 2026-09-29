import { invitationReturnPath } from '../../../../kernel/invitation-return-path';

export interface MagicLinkCallbackHandlerDependencies {
  readonly isExpectedPurpose: (token: string, proof: string | null) => boolean;
  readonly verifyMagicLink: (
    token: string,
    headers: Headers,
    returnTo: string,
  ) => Promise<Response>;
}

function invalidRedirect(request: Request): Response {
  return Response.redirect(new URL('/auth/link-invalid', request.url), 302);
}

/** [BM-008] [BM-010] [DR-ID-02..03] Accept only sign-in-bound links at this callback. */
export function createMagicLinkCallbackHandler(
  dependencies: MagicLinkCallbackHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const proof = url.searchParams.get('proof');
    const returnTo = invitationReturnPath(url.searchParams.get('returnTo')) ?? '/account';
    if (!token || !dependencies.isExpectedPurpose(token, proof)) return invalidRedirect(request);
    try {
      const response = await dependencies.verifyMagicLink(token, request.headers, returnTo);
      if (response.status < 300 || response.status >= 400) return invalidRedirect(request);
      const location = response.headers.get('location');
      if (location && new URL(location, request.url).pathname === '/auth/link-invalid') {
        return invalidRedirect(request);
      }
      return response;
    } catch {
      return invalidRedirect(request);
    }
  };
}
