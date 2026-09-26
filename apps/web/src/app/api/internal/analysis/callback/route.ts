import { handleAnalysisCallback } from '../../../../../server/analysis-callback-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleAnalysisCallback(request);
}
