import { createPublishSeasonHandler } from '../../../../../../../server/season-command-handler';
import { seasonCommandHandlerDependencies } from '../../../../../../../server/seasons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly seasonId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, seasonId } = await context.params;
  return createPublishSeasonHandler(seasonCommandHandlerDependencies(request))(
    request,
    houseId,
    seasonId,
  );
}
