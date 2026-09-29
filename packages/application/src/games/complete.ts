import type {
  DrawGameRequest,
  GameCompletionDependencies,
  GameLifecycleResult,
  ResignGameRequest,
} from '@between-moves/domain';
import { retryTransaction } from '../shared/retry-transaction';

async function authorizedInput(
  request: ResignGameRequest,
  dependencies: GameCompletionDependencies,
) {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'create_or_join_game' },
    request.houseId,
    request.viewer,
  );
  return {
    context,
    input: {
      gameId: request.gameId,
      clientCommandId: request.clientCommandId,
      completedAt: dependencies.clock.now(),
      completedEventId: dependencies.ids.generate(),
      analysisEventId: dependencies.ids.generate(),
    },
  };
}

/** [BM-028] [DR-GAME-05] Complete an active Game when a seated Member resigns. */
export async function resignGame(
  request: ResignGameRequest,
  dependencies: GameCompletionDependencies,
): Promise<GameLifecycleResult> {
  const { context, input } = await authorizedInput(request, dependencies);
  return retryTransaction(() => dependencies.completions.resign(context, input));
}

/** [BM-028] [DR-DRAW-01/02] Offer, accept, or decline one House-scoped draw offer. */
export async function handleDraw(
  request: DrawGameRequest,
  dependencies: GameCompletionDependencies,
): Promise<GameLifecycleResult> {
  const { context, input } = await authorizedInput(request, dependencies);
  const offerEventId = dependencies.ids.generate();
  return retryTransaction(() =>
    dependencies.completions.draw(context, { ...input, action: request.action, offerEventId }),
  );
}
