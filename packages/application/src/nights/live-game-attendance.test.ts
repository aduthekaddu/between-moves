import type {
  ClaimedOutboxEvent,
  CompletedLiveNightGame,
  NightAttendanceLeaveResult,
  QualifyNightAttendanceInput,
} from '@between-moves/domain';
import { PermanentOutboxError } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createLiveGameAttendanceConsumer } from './live-game-attendance';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000501';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const white = '01941f29-7c00-7000-8000-000000000301';
const black = '01941f29-7c00-7000-8000-000000000302';
const completedAt = new Date('2026-09-04T14:40:00.000Z');

function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000601',
    topic: 'game.completed',
    aggregateId: gameId,
    sequence: 9n,
    houseId,
    // a forged payload must not decide who attended
    payload: { result: 'white_win', membershipIds: ['someone-else'] },
    attempts: 1,
    availableAt: completedAt,
    occurredAt: completedAt,
    ...overrides,
  };
}

const game: CompletedLiveNightGame = {
  houseId,
  gameId,
  nightId,
  completedAt,
  membershipIds: [white, black],
};

function qualified(
  input: QualifyNightAttendanceInput,
  emitted: boolean,
): NightAttendanceLeaveResult {
  return {
    attendanceId: input.attendanceId ?? 'attendance',
    houseId,
    nightId,
    seasonId: '01941f29-7c00-7000-8000-000000000701',
    membershipId: input.membershipId,
    firstJoinedAt: completedAt,
    currentJoinedAt: null,
    lastLeftAt: null,
    accumulatedSeconds: 0,
    qualifiedAt: completedAt,
    qualificationReason: 'completed_live_game',
    leftNow: false,
    scoringEventEmitted: emitted,
    sourceKey: emitted ? `night:${nightId}` : null,
  };
}

function harness(found: CompletedLiveNightGame | null, emitted = true) {
  let next = 0;
  const dependencies = {
    games: { readCompletedLiveGame: vi.fn(async () => found) },
    attendance: {
      qualify: vi.fn(async (input: QualifyNightAttendanceInput) => qualified(input, emitted)),
    },
    ids: { generate: vi.fn(() => `id-${next++}`) },
    events: { record: vi.fn() },
  };
  return { dependencies, consumer: createLiveGameAttendanceConsumer(dependencies) };
}

describe('Live Game attendance consumer', () => {
  it('[BM-033] [DR-NIGHT-05] qualifies both players of a live Night Game from durable state', async () => {
    const { consumer, dependencies } = harness(game);

    await expect(consumer.consume(event())).resolves.toBe('processed');
    expect(dependencies.games.readCompletedLiveGame).toHaveBeenCalledWith({ houseId, gameId });
    expect(dependencies.attendance.qualify.mock.calls.map(([input]) => input)).toEqual([
      {
        houseId,
        nightId,
        membershipId: white,
        attendanceId: 'id-0',
        scoringEventId: 'id-1',
        qualifiedAt: completedAt,
        reason: 'completed_live_game',
      },
      {
        houseId,
        nightId,
        membershipId: black,
        attendanceId: 'id-2',
        scoringEventId: 'id-3',
        qualifiedAt: completedAt,
        reason: 'completed_live_game',
      },
    ]);
    expect(dependencies.events.record).toHaveBeenCalledTimes(2);
  });

  it('[BM-033] treats correspondence Games and redeliveries as duplicates', async () => {
    const correspondence = harness(null);
    await expect(correspondence.consumer.consume(event())).resolves.toBe('duplicate');
    expect(correspondence.dependencies.attendance.qualify).not.toHaveBeenCalled();

    const redelivered = harness(game, false);
    await expect(redelivered.consumer.consume(event())).resolves.toBe('duplicate');
    expect(redelivered.dependencies.events.record).not.toHaveBeenCalled();
  });

  it('[BM-033] parks events it can never process', async () => {
    const { consumer } = harness(game);

    await expect(consumer.consume(event({ topic: 'game.move-accepted' }))).rejects.toBeInstanceOf(
      PermanentOutboxError,
    );
    await expect(consumer.consume(event({ houseId: null }))).rejects.toBeInstanceOf(
      PermanentOutboxError,
    );
  });
});
