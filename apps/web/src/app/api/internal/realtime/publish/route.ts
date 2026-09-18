import { handleRealtimePublish } from '../../../../../server/realtime-publish-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** [BM-038] Worker-only signed realtime publish. */
export async function POST(request: Request): Promise<Response> {
  return handleRealtimePublish(request);
}
