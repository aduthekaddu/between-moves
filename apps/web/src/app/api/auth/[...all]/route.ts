import { getAuth } from '../../../../server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/sign-in/magic-link') || path.endsWith('/magic-link/verify')) {
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
