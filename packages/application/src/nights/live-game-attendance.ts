import {
  GAME_COMPLETED_TOPIC,
  PermanentOutboxError,
  type LiveGameAttendanceConsumerDependencies,
  type OutboxConsumer,
} from '@between-moves/domain';

/**
 * [BM-033] [DR-NIGHT-05] When a live Game on a Night completes, both players attended that
 * Night. Identity comes from the durable Game, never the event payload, and qualification is
 * idempotent, so a redelivered event awards nothing twice.
 */
export function createLiveGameAttendanceConsumer(
  dependencies: LiveGameAttendanceConsumerDependencies,
): OutboxConsumer {
  return {
    async consume(event) {
      if (event.topic !== GAME_COMPLETED_TOPIC) {
        throw new PermanentOutboxError('Unsupported live Game attendance topic');
      }
      if (event.houseId === null) {
        throw new PermanentOutboxError('Live Game attendance event is missing a House id');
      }
      const game = await dependencies.games.readCompletedLiveGame({
        houseId: event.houseId,
        gameId: event.aggregateId,
      });
      // correspondence Games, and live Games played outside a Night, carry no attendance
      if (game === null) return 'duplicate';
      let qualified = 0;
      for (const membershipId of game.membershipIds) {
        const result = await dependencies.attendance.qualify({
          houseId: game.houseId,
          nightId: game.nightId,
          membershipId,
          attendanceId: dependencies.ids.generate(),
          scoringEventId: dependencies.ids.generate(),
          qualifiedAt: game.completedAt,
          reason: 'completed_live_game',
        });
        if (result === null || !result.scoringEventEmitted || result.sourceKey === null) continue;
        qualified += 1;
        try {
          dependencies.events.record({
            actorId: 'anonymous',
            attendanceId: result.attendanceId,
            houseId: result.houseId,
            nightId: result.nightId,
            sourceKey: result.sourceKey,
          });
        } catch {
          // Diagnostics never alter committed attendance or its scoring event.
        }
      }
      return qualified > 0 ? 'processed' : 'duplicate';
    },
  };
}
