import {
  getHouseChat,
  houseChatHandlerDependencies,
} from '../../../../../../../modules/nights/chat';
import {
  createPostHouseChatHandler,
  createReadHouseChatHandler,
} from '../../../../../../../server/house-chat-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly houseId: string; readonly nightId: string }>;
}

/** [BM-040] GET /api/houses/{houseId}/nights/{nightId}/chat. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createReadHouseChatHandler({ readHouseChat: getHouseChat })(request, houseId, nightId);
}

/** [BM-040] POST /api/houses/{houseId}/nights/{nightId}/chat. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId } = await context.params;
  return createPostHouseChatHandler(houseChatHandlerDependencies(request))(
    request,
    houseId,
    nightId,
  );
}
