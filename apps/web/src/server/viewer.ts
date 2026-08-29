import { createViewerResolver } from '@between-moves/application';
import type { AuthenticatedViewer, Viewer } from '@between-moves/domain';
import { getAuth } from './auth';
import { createBetterAuthSessionReader } from './better-auth-session-reader';
import { getIdentityRecoveryRepository } from './identity-recovery';
import { getLogger } from './logger';

function resolver() {
  return createViewerResolver(
    createBetterAuthSessionReader(getAuth(), getIdentityRecoveryRepository(), getLogger()),
  );
}

/** [BM-007] Resolve a request to authenticated or anonymous identity. */
export function getViewer(request: Request): Promise<Viewer> {
  return resolver().getViewer(request);
}

/** [BM-007] Reject unless a DB-validated authenticated identity exists. */
export function requireViewer(request: Request): Promise<AuthenticatedViewer> {
  return resolver().requireViewer(request);
}
