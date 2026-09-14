import type { AuthenticatedViewer, DomainError, GameLifecycleResult } from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';

interface ObservationDependencies {
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export interface GameCompletionObservation {
  readonly requestId: string;
  readonly viewer: AuthenticatedViewer;
  readonly houseId: string;
  readonly gameId: string;
  readonly commandId: string;
  readonly source: 'move' | 'resign' | 'draw';
  readonly startedAt: Date;
}

/** [BM-028] Record completion without making diagnostics part of command success. */
export function recordGameCompleted(
  dependencies: ObservationDependencies,
  observation: GameCompletionObservation,
  result: GameLifecycleResult,
): void {
  if (!result.completedNow) return;
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: observation.requestId,
      actorId: observation.viewer.userId,
      houseId: result.houseId,
      gameId: result.gameId,
      commandId: observation.commandId,
      event: 'game.completed',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - observation.startedAt.getTime()),
      data: {
        source: observation.source,
        result: result.result,
        resultReason: result.resultReason,
      },
    });
  } catch {
    // A committed completion remains successful when diagnostics are unavailable.
  }
}

/** [BM-028] [DR-SEC-06] Observe seated/state denials without private Game data. */
export function recordGameCompletionRejected(
  dependencies: ObservationDependencies,
  observation: GameCompletionObservation,
  error: DomainError,
): void {
  try {
    dependencies.logger.log({
      level: 'info',
      requestId: observation.requestId,
      actorId: observation.viewer.userId,
      houseId: observation.houseId,
      gameId: observation.gameId,
      commandId: observation.commandId,
      event: 'game.completion-rejected',
      outcome: 'rejected',
      durationMs: Math.max(0, dependencies.clock.now().getTime() - observation.startedAt.getTime()),
      data: { source: observation.source, code: error.code },
    });
  } catch {
    // A rejection response does not depend on diagnostics.
  }
}
