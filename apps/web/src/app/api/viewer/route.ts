import { AuthenticationRequiredError, type AuthenticatedViewer } from '@between-moves/domain';
import { problemResponse } from '../../../kernel/request';
import { requireViewer } from '../../../server/viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RequireViewer = (request: Request) => Promise<AuthenticatedViewer>;

/** [BM-007] Protected-route evidence for authenticated versus anonymous access. */
export async function createViewerResponse(
  request: Request,
  resolveViewer: RequireViewer = requireViewer,
): Promise<Response> {
  try {
    const viewer = await resolveViewer(request);
    return Response.json({ viewer }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;

    return problemResponse(
      request,
      401,
      'unauthenticated',
      'Authentication required',
      'Sign in to access this resource.',
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return createViewerResponse(request);
}
