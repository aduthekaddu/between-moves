import { houseChatHandlerDependencies } from '../../../../../../../../modules/nights/chat';
import { createDeleteHouseChatHandler } from '../../../../../../../../server/house-chat-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{
    readonly houseId: string;
    readonly nightId: string;
    readonly messageId: string;
  }>;
}

/** [BM-040] DELETE /api/houses/{houseId}/nights/{nightId}/chat/{messageId}. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { houseId, nightId, messageId } = await context.params;
  return createDeleteHouseChatHandler(houseChatHandlerDependencies(request))(
    request,
    houseId,
    nightId,
    messageId,
  );
}
