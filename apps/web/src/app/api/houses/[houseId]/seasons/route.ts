import { createDraftSeasonHandler } from '../../../../../server/season-command-handler';
import { seasonCommandHandlerDependencies } from '../../../../../server/seasons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId } = await context.params;
  return createDraftSeasonHandler(seasonCommandHandlerDependencies(request))(request, houseId);
}
