import { nightRailSnapshotSchema, type NightRailSnapshotResponse } from '@between-moves/contracts';
import type { NightRailSnapshot } from '@between-moves/domain';

function iso(value: Date): string {
  return value.toISOString();
}

function instant(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid Night rail timestamp');
  return parsed;
}

function player(value: NightRailSnapshot['activeBoards'][number]['white']) {
  return { membershipId: value.membershipId, name: value.name };
}

/** [BM-038] JSON snapshot with decimal sequences for the Night rail wire format. */
export function serializeNightRailSnapshot(snapshot: NightRailSnapshot): NightRailSnapshotResponse {
  return nightRailSnapshotSchema.parse({
    houseId: snapshot.houseId,
    nightId: snapshot.nightId,
    seasonId: snapshot.seasonId,
    state: snapshot.state,
    scheduledStart: iso(snapshot.scheduledStart),
    scheduledEnd: iso(snapshot.scheduledEnd),
    startedAt: snapshot.startedAt === null ? null : iso(snapshot.startedAt),
    endedAt: snapshot.endedAt === null ? null : iso(snapshot.endedAt),
    nightSequence: snapshot.nightSequence.toString(),
    presenceCount: snapshot.presenceCount,
    activeBoards: snapshot.activeBoards.map((board) => ({
      gameId: board.gameId,
      sequence: board.sequence.toString(),
      currentFen: board.currentFen,
      currentPly: board.currentPly,
      sideToMove: board.sideToMove,
      lastSan: board.lastSan,
      white: player(board.white),
      black: player(board.black),
    })),
    recentResults: snapshot.recentResults.map((result) => ({
      gameId: result.gameId,
      sequence: result.sequence.toString(),
      result: result.result,
      resultReason: result.resultReason,
      completedAt: iso(result.completedAt),
      white: player(result.white),
      black: player(result.black),
    })),
  });
}

/** [BM-038] Restore bigint sequences after a JSON rail read. */
export function parseNightRailSnapshot(payload: NightRailSnapshotResponse): NightRailSnapshot {
  const parsed = nightRailSnapshotSchema.parse(payload);
  return {
    houseId: parsed.houseId,
    nightId: parsed.nightId,
    seasonId: parsed.seasonId,
    state: parsed.state,
    scheduledStart: instant(parsed.scheduledStart),
    scheduledEnd: instant(parsed.scheduledEnd),
    startedAt: parsed.startedAt === null ? null : instant(parsed.startedAt),
    endedAt: parsed.endedAt === null ? null : instant(parsed.endedAt),
    nightSequence: BigInt(parsed.nightSequence),
    presenceCount: parsed.presenceCount,
    activeBoards: parsed.activeBoards.map((board) => ({
      gameId: board.gameId,
      sequence: BigInt(board.sequence),
      currentFen: board.currentFen,
      currentPly: board.currentPly,
      sideToMove: board.sideToMove,
      lastSan: board.lastSan,
      white: player(board.white),
      black: player(board.black),
    })),
    recentResults: parsed.recentResults.map((result) => ({
      gameId: result.gameId,
      sequence: BigInt(result.sequence),
      result: result.result,
      resultReason: result.resultReason,
      completedAt: instant(result.completedAt),
      white: player(result.white),
      black: player(result.black),
    })),
  };
}
