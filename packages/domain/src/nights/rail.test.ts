import { describe, expect, it } from 'vitest';
import {
  applyRailRealtimeEvent,
  applyRailRealtimeEventOrRepair,
  GAME_COMPLETED_TOPIC,
  GAME_DRAW_OFFER_CHANGED_TOPIC,
  GAME_MOVE_ACCEPTED_TOPIC,
  nightSequenceForState,
  type NightRailSnapshot,
} from './rail';

const gameId = '01941f29-7c00-7000-8000-000000000801';
const nightId = '01941f29-7c00-7000-8000-000000000901';

function snapshot(overrides: Partial<NightRailSnapshot> = {}): NightRailSnapshot {
  return {
    houseId: '01941f29-7c00-7000-8000-000000000201',
    nightId,
    seasonId: '01941f29-7c00-7000-8000-000000000701',
    state: 'live',
    scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
    scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
    startedAt: new Date('2026-09-04T14:00:00.000Z'),
    endedAt: null,
    nightSequence: 1n,
    presence: [
      {
        clientId: '01941f29-7c00-7000-8000-000000000101',
        displayName: 'Ada',
        signature: 'a'.repeat(43),
      },
      {
        clientId: '01941f29-7c00-7000-8000-000000000102',
        displayName: 'Bea',
        signature: 'b'.repeat(43),
      },
    ],
    presenceCount: 2,
    activeBoards: [
      {
        gameId,
        sequence: 1n,
        currentFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        currentPly: 1,
        sideToMove: 'black',
        lastSan: 'e4',
        white: { membershipId: 'white', name: 'Ada' },
        black: { membershipId: 'black', name: 'Bea' },
      },
    ],
    recentResults: [],
    ...overrides,
  };
}

describe('Night rail snapshot application', () => {
  it('[BM-038] applies the next Game Move and ignores a redelivered sequence', () => {
    const current = snapshot();
    const applied = applyRailRealtimeEvent(current, {
      topic: GAME_MOVE_ACCEPTED_TOPIC,
      aggregateId: gameId,
      sequence: 2n,
      payload: {
        ply: 2,
        uci: 'e7e5',
        san: 'e5',
        fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        sideToMove: 'white',
      },
    });

    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') return;
    expect(applied.snapshot.activeBoards[0]).toMatchObject({
      sequence: 2n,
      lastSan: 'e5',
      sideToMove: 'white',
      currentPly: 2,
    });
    expect(
      applyRailRealtimeEvent(applied.snapshot, {
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        aggregateId: gameId,
        sequence: 2n,
        payload: {
          ply: 2,
          uci: 'e7e5',
          san: 'e5',
          fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
          sideToMove: 'white',
        },
      }),
    ).toEqual({ kind: 'ignored' });
  });

  it('[BM-038] signals a sequence gap so the client can repair from a durable read', () => {
    expect(
      applyRailRealtimeEvent(snapshot(), {
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        aggregateId: gameId,
        sequence: 4n,
        payload: {
          ply: 4,
          uci: 'g1f3',
          san: 'Nf3',
          fenAfter: '8/8/8/8/8/5N2/8/8 b - - 1 2',
          sideToMove: 'black',
        },
      }),
    ).toEqual({ kind: 'gap' });
  });

  it('[BM-028] advances a board past a draw offer so the next Move is not a gap', () => {
    const offered = applyRailRealtimeEvent(snapshot(), {
      topic: GAME_DRAW_OFFER_CHANGED_TOPIC,
      aggregateId: gameId,
      sequence: 2n,
      payload: { change: 'offered', ply: 1 },
    });
    expect(offered.kind).toBe('applied');
    if (offered.kind !== 'applied') return;
    expect(offered.snapshot.activeBoards[0]).toMatchObject({
      sequence: 2n,
      currentPly: 1,
      lastSan: 'e4',
    });

    const reply = applyRailRealtimeEvent(offered.snapshot, {
      topic: GAME_MOVE_ACCEPTED_TOPIC,
      aggregateId: gameId,
      sequence: 3n,
      payload: {
        fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        san: 'e5',
        ply: 2,
        sideToMove: 'white',
      },
    });
    expect(reply.kind).toBe('applied');
    expect(
      applyRailRealtimeEvent(snapshot(), {
        topic: GAME_DRAW_OFFER_CHANGED_TOPIC,
        aggregateId: gameId,
        sequence: 4n,
        payload: { change: 'declined', ply: 1 },
      }),
    ).toEqual({ kind: 'gap' });
  });

  it('[BM-038] moves a completed board onto recent results', () => {
    const applied = applyRailRealtimeEvent(snapshot(), {
      topic: GAME_COMPLETED_TOPIC,
      aggregateId: gameId,
      sequence: 2n,
      payload: {
        result: 'white_win',
        resultReason: 'resign',
        completedAt: '2026-09-04T14:20:00.000Z',
      },
    });

    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') return;
    expect(applied.snapshot.activeBoards).toEqual([]);
    expect(applied.snapshot.recentResults).toEqual([
      expect.objectContaining({
        gameId,
        result: 'white_win',
        sequence: 2n,
        white: { membershipId: 'white', name: 'Ada' },
      }),
    ]);
  });

  it('[BM-038] treats an unknown board as a gap so a durable read can add it', () => {
    expect(
      applyRailRealtimeEvent(snapshot({ activeBoards: [] }), {
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        aggregateId: gameId,
        sequence: 1n,
        payload: {
          ply: 1,
          uci: 'e2e4',
          san: 'e4',
          fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
          sideToMove: 'black',
        },
      }),
    ).toEqual({ kind: 'gap' });
  });

  it('[BM-038] [BM-039] applies the next Night event without changing ephemeral presence', () => {
    const applied = applyRailRealtimeEvent(snapshot(), {
      topic: 'night.ended',
      aggregateId: nightId,
      sequence: 2n,
      payload: { presenceCount: 0, at: '2026-09-04T16:00:00.000Z' },
    });

    expect(applied).toMatchObject({
      kind: 'applied',
      snapshot: {
        state: 'ended',
        nightSequence: 2n,
        presenceCount: 2,
        presence: snapshot().presence,
        endedAt: new Date('2026-09-04T16:00:00.000Z'),
      },
    });
  });

  it('[BM-038] ignores a Night lifecycle event without the committed instant', () => {
    expect(
      applyRailRealtimeEvent(snapshot(), {
        topic: 'night.ended',
        aggregateId: nightId,
        sequence: 2n,
        payload: { presenceCount: 0 },
      }),
    ).toEqual({ kind: 'ignored' });
  });

  it('[BM-038] derives the durable Night sequence from lifecycle state', () => {
    expect(nightSequenceForState('scheduled')).toBe(0n);
    expect(nightSequenceForState('live')).toBe(1n);
    expect(nightSequenceForState('ended')).toBe(2n);
    expect(nightSequenceForState('cancelled')).toBe(0n);
  });

  it('[BM-038] repairs a sequence gap from a fresh durable read', async () => {
    const repaired = snapshot({
      activeBoards: [
        {
          gameId,
          sequence: 4n,
          currentFen: '8/8/8/8/8/5N2/8/8 b - - 1 2',
          currentPly: 4,
          sideToMove: 'black',
          lastSan: 'Nf3',
          white: { membershipId: 'white', name: 'Ada' },
          black: { membershipId: 'black', name: 'Bea' },
        },
      ],
    });
    const result = await applyRailRealtimeEventOrRepair(
      snapshot(),
      {
        topic: GAME_MOVE_ACCEPTED_TOPIC,
        aggregateId: gameId,
        sequence: 4n,
        payload: {
          ply: 4,
          uci: 'g1f3',
          san: 'Nf3',
          fenAfter: '8/8/8/8/8/5N2/8/8 b - - 1 2',
          sideToMove: 'black',
        },
      },
      async () => repaired,
    );

    expect(result).toEqual({ snapshot: repaired, outcome: 'repaired' });
  });
});
