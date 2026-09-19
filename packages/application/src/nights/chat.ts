import {
  validateHouseChatBody,
  type DeleteHouseChatDependencies,
  type DeleteHouseChatRequest,
  type HouseChatMessage,
  type HouseChatSnapshot,
  type PostHouseChatDependencies,
  type PostHouseChatRequest,
  type ReadHouseChatDependencies,
  type ReadHouseChatRequest,
} from '@between-moves/domain';

/** [BM-040] [DR-SEC-01] Authorize and persist one House chat message before publication. */
export async function postHouseChat(
  request: PostHouseChatRequest,
  dependencies: PostHouseChatDependencies,
): Promise<HouseChatMessage> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'write_house_chat_or_game_note' },
    request.houseId,
    request.viewer,
  );
  const body = validateHouseChatBody(request.body);
  return dependencies.chat.post(context, {
    id: dependencies.ids.generate(),
    eventId: dependencies.ids.generate(),
    nightId: request.nightId,
    body,
    postedAt: dependencies.clock.now(),
  });
}

/** [BM-040] Read recent durable House chat before realtime attaches. */
export async function readHouseChat(
  request: ReadHouseChatRequest,
  dependencies: ReadHouseChatDependencies,
): Promise<HouseChatSnapshot | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.chat.readRecent(context, request.nightId);
}

/** [BM-040] Soft-delete a House chat message as an owner or steward. */
export async function deleteHouseChat(
  request: DeleteHouseChatRequest,
  dependencies: DeleteHouseChatDependencies,
): Promise<void> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'moderate_house_chat' },
    request.houseId,
    request.viewer,
  );
  await dependencies.chat.softDelete(context, {
    eventId: dependencies.ids.generate(),
    nightId: request.nightId,
    messageId: request.messageId,
    deletedAt: dependencies.clock.now(),
  });
}
