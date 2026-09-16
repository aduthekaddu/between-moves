import type {
  GameReaction,
  GameReactionValue,
  ReadCurrentGameReactionRequest,
  ReadGameReactionDependencies,
  SetGameReactionDependencies,
  SetGameReactionRequest,
} from '@between-moves/domain';

/** [BM-031] [DR-REACT-01] Set or replace one Member's current Reaction. */
export async function setGameReaction(
  request: SetGameReactionRequest,
  dependencies: SetGameReactionDependencies,
): Promise<GameReaction> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'set_game_reaction' },
    request.houseId,
    request.viewer,
  );
  return dependencies.reactions.set(context, {
    id: dependencies.ids.generate(),
    gameId: request.gameId,
    reaction: request.reaction,
    reactedAt: dependencies.clock.now(),
  });
}

/** [BM-031] Read the viewer's persisted selection for a completed Game. */
export async function readCurrentGameReaction(
  request: ReadCurrentGameReactionRequest,
  dependencies: ReadGameReactionDependencies,
): Promise<GameReactionValue | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.reactions.readCurrent(context, request.gameId);
}
