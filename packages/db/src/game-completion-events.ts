import type {
  AuthorizationContext,
  CompletedGameResult,
  GameCompletionReason,
} from '@between-moves/domain';
import { enqueueOutboxEvent, type OutboxTransaction } from './enqueue-outbox-event';

export interface CompletionEventInput {
  readonly gameId: string;
  readonly completedEventId: string;
  readonly analysisEventId: string;
  readonly result: CompletedGameResult;
  readonly resultReason: GameCompletionReason;
  readonly completedAt: Date;
  readonly firstSequence: number;
}

/** [BM-028] Completion, scoring, and optional analysis signals share the state transaction. */
export async function enqueueGameCompletionEvents(
  context: AuthorizationContext,
  input: CompletionEventInput,
  transaction: OutboxTransaction,
): Promise<void> {
  const payload = {
    result: input.result,
    resultReason: input.resultReason,
    completedAt: input.completedAt.toISOString(),
  };
  await enqueueOutboxEvent(
    {
      id: input.completedEventId,
      topic: 'game.completed',
      aggregateId: input.gameId,
      sequence: BigInt(input.firstSequence),
      houseId: context.houseId,
      payload,
      availableAt: input.completedAt,
      occurredAt: input.completedAt,
    },
    transaction,
  );
  await enqueueOutboxEvent(
    {
      id: input.analysisEventId,
      topic: 'game.analysis-requested',
      aggregateId: input.gameId,
      sequence: BigInt(input.firstSequence + 1),
      houseId: context.houseId,
      payload,
      availableAt: input.completedAt,
      occurredAt: input.completedAt,
    },
    transaction,
  );
}
