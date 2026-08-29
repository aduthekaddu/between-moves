export interface MagicLinkCallbackHandlerDependencies {
  readonly verifyMagicLink: (token: string, headers: Headers) => Promise<Response>;
}

function invalidRedirect(request: Request): Response {
  return Response.redirect(new URL('/auth/link-invalid', request.url), 302);
}

/** [BM-008] [DR-ID-02..03] Forwards Better Auth's rotated cookie without leaking failure cause. */
export function createMagicLinkCallbackHandler(
  dependencies: MagicLinkCallbackHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return invalidRedirect(request);
    try {
      const response = await dependencies.verifyMagicLink(token, request.headers);
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
