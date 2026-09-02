import {
  RetryableTransactionError,
  type SubmitMoveDependencies,
  type SubmitMoveRequest,
  type SubmitMoveResult,
} from '@between-moves/domain';

const MAXIMUM_TRANSACTION_ATTEMPTS = 3;

async function retryTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof RetryableTransactionError) ||
        attempt >= MAXIMUM_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}

/** [BM-024] [DR-MOVE-01/02] The sole durable Move application path for both Game modes. */
export async function submitMove(
  request: SubmitMoveRequest,
  dependencies: SubmitMoveDependencies,
): Promise<SubmitMoveResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_or_join_game' },
    request.houseId,
    request.viewer,
  );
  const input = {
    gameId: request.gameId,
    expectedPly: request.expectedPly,
    clientCommandId: request.clientCommandId,
    move: request.move,
    moveId: dependencies.ids.generate(),
    outboxEventId: dependencies.ids.generate(),
    receivedAt: dependencies.clock.now(),
    rules: dependencies.rules,
  };
  return retryTransaction(() => dependencies.moves.submit(context, input));
}
