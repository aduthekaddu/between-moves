import type {
  AcceptGameSeatRequest,
  GameSeatAcceptanceDependencies,
  GameSeatAcceptanceResult,
} from '@between-moves/domain';

/** [BM-023] [DR-SEAT-03] Authorize and accept one House-scoped Open seat. */
export async function acceptGameSeat(
  request: AcceptGameSeatRequest,
  dependencies: GameSeatAcceptanceDependencies,
): Promise<GameSeatAcceptanceResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_or_join_game' },
    request.houseId,
    request.viewer,
  );
  return dependencies.acceptances.accept(context, {
    gameId: request.gameId,
    acceptedAt: dependencies.clock.now(),
  });
}
