import { getAuth } from '../../../../server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function handle(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
