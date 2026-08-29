import {
  AuthenticationRequiredError,
  type AuthenticatedViewer,
  type SessionIdentityReader,
  type Viewer,
} from '@between-moves/domain';

export interface ViewerResolver<RequestContext> {
  getViewer(request: RequestContext): Promise<Viewer>;
  requireViewer(request: RequestContext): Promise<AuthenticatedViewer>;
}

/** [BM-007] [DR-ID-01] Resolve identity without granting any House permissions. */
export function createViewerResolver<RequestContext>(
  sessions: SessionIdentityReader<RequestContext>,
): ViewerResolver<RequestContext> {
  async function getViewer(request: RequestContext): Promise<Viewer> {
    const identity = await sessions.read(request);
    return identity === null
      ? { kind: 'anonymous' }
      : {
          kind: 'authenticated',
          userId: identity.userId,
          displayName: identity.displayName,
          imageUrl: identity.imageUrl,
        };
  }

  async function requireViewer(request: RequestContext): Promise<AuthenticatedViewer> {
    const viewer = await getViewer(request);
    if (viewer.kind === 'anonymous') throw new AuthenticationRequiredError();
    return viewer;
  }

  return { getViewer, requireViewer };
}
