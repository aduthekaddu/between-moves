import type {
  CancelGameSeatRequest,
  GameSeatCancellationDependencies,
  GameSeatCancellationResult,
} from '@between-moves/domain';

/**
 * [BM-022] [BM-023] Authorize a House Member, then cancel their own open seat or decline a
 * challenge made to them. The repository decides which of the two the viewer may do.
 */
export async function cancelGameSeat(
  request: CancelGameSeatRequest,
  dependencies: GameSeatCancellationDependencies,
): Promise<GameSeatCancellationResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_or_join_game' },
    request.houseId,
    request.viewer,
  );
  return dependencies.cancellations.cancel(context, {
    gameId: request.gameId,
    cancelledAt: dependencies.clock.now(),
  });
}
