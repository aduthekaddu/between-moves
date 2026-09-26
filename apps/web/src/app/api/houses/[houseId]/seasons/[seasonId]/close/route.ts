import {
  closeSeasonHandlerDependencies,
  createCloseSeasonHandler,
} from '../../../../../../../modules/seasons/close';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly seasonId: string }>;
}

/** Close or resume closing the routed Season through the authenticated command handler. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, seasonId } = await context.params;
  return createCloseSeasonHandler(closeSeasonHandlerDependencies(request))(
    request,
    houseId,
    seasonId,
  );
}
