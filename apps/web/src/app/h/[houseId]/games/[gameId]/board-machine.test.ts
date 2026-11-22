import { describe, expect, it } from 'vitest';
import {
  initialBoardState,
  liveBoard,
  shownPosition,
  transition,
  type BoardEffect,
  type BoardEvent,
  type BoardState,
  type Environment,
} from './board-machine';
import { requireFen } from './board-model';
import { replayPositions } from './game-review';
import type { MoveEntryPosition } from './move-entry-wire';

const env: Environment = { online: true, visible: true, wideEnough: true };

const start: MoveEntryPosition = {
  mode: 'correspondence',
  currentFen: requireFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  state: 'active',
  viewerColor: 'white',
  white: { name: 'Ada' },
  black: { name: 'Bea' },
  moveDueAt: null,
  result: null,
  inCheck: false,
  moves: [],
};
const afterE4: MoveEntryPosition = {
  ...start,
  currentFen: requireFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
  currentPly: 1,
  sideToMove: 'black',
  version: 1,
  moves: [{ ply: 1, uci: 'e2e4', san: 'e4' }],
};
const afterE5: MoveEntryPosition = {
  ...afterE4,
  currentFen: requireFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'),
  currentPly: 2,
  sideToMove: 'white',
  version: 2,
  moves: [...afterE4.moves, { ply: 2, uci: 'e7e5', san: 'e5' }],
};

/** Runs events in order and keeps every effect, as the store would. */
function run(state: BoardState, events: readonly BoardEvent[], environment = env) {
  const effects: BoardEffect[] = [];
  let current = state;
  for (const event of events) {
    const [next, emitted] = transition(current, event, environment);
    current = next;
    effects.push(...emitted);
  }
  return { state: current, effects };
}

function placement(state: BoardState): string {
  const shown = shownPosition(state, replayPositions(state.snapshot.moves, state.snapshot.currentFen));
  return shown.fen.split(' ')[0]!;
}

const playE4: readonly BoardEvent[] = [
  { type: 'squareTapped', square: 'e2', commandId: 'c1' },
  { type: 'squareTapped', square: 'e4', commandId: 'c1' },
];
const e4Board = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const startBoard = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('board machine', () => {
  it('keeps a staged Move on the board when a read that started earlier lands (3f99799)', () => {
    const { state } = run(initialBoardState(start), [
      { type: 'reconcileWanted', background: true },
      ...playE4,
      { type: 'readAnswered', requestId: 1, snapshot: start },
    ]);
    expect(state.command.kind).toBe('staged');
    expect(placement(state)).toBe(e4Board);
  });

  it('takes in what a read brings during the Undo window, and Undo shows it (304aa9e)', () => {
    const resigned = { ...start, version: 1, state: 'completed' as const, result: 'black_win' as const };
    const { state, effects } = run(initialBoardState(start), [
      { type: 'reconcileWanted', background: true },
      ...playE4,
      { type: 'readAnswered', requestId: 1, snapshot: resigned },
      { type: 'undoPressed' },
    ]);
    expect(state.snapshot.state).toBe('completed');
    expect(placement(state)).toBe(startBoard);
    expect(effects.filter((effect) => effect.kind === 'readGame')).toHaveLength(1);
  });

  it('shows the newest board after a failed send, not the board from before it (#63)', () => {
    const live = { ...start, mode: 'live' as const };
    const elsewhere = { ...afterE4, mode: 'live' as const, version: 2 };
    const { state } = run(initialBoardState(live), [
      ...playE4,
      { type: 'refreshRequested' },
      { type: 'readAnswered', requestId: 2, snapshot: elsewhere },
      { type: 'moveAnswered', requestId: 1, answer: { kind: 'unreachable' } },
    ]);
    expect(state.command.kind).toBe('retryable');
    expect(placement(state)).toBe(e4Board);
    expect(liveBoard(state).version).toBe(2);
  });

  it('keeps the newer board when a retried Move returns its first answer (version is not ply)', () => {
    const { state } = run(initialBoardState(start), [
      ...playE4,
      { type: 'undoWindowEnded', clientCommandId: 'c1' },
      { type: 'moveAnswered', requestId: 1, answer: { kind: 'unreachable' } },
      { type: 'reconcileWanted', background: true },
      { type: 'readAnswered', requestId: 2, snapshot: { ...afterE5, version: 3 } },
      { type: 'retryPressed' },
    ]);
    expect(state.command.kind).toBe('none');
    const retried = run(state, [
      {
        type: 'moveAnswered',
        requestId: 3,
        answer: { kind: 'accepted', move: { ply: 1, uci: 'e2e4', san: 'e4', fenAfter: afterE4.currentFen, sideToMove: 'black', version: 1 } },
      },
    ]);
    expect(retried.state.snapshot.version).toBe(3);
    expect(retried.state.snapshot.moves).toHaveLength(2);
  });

  it('reads once more after a Move is accepted while an earlier read is out', () => {
    const live = { ...start, mode: 'live' as const };
    const accepted = {
      kind: 'accepted' as const,
      move: { ply: 1, uci: 'e2e4', san: 'e4', fenAfter: afterE4.currentFen, sideToMove: 'black' as const, version: 1 },
    };
    const sent = run(initialBoardState(live), [
      { type: 'reconcileWanted', background: true },
      ...playE4,
      { type: 'moveAnswered', requestId: 2, answer: accepted },
    ]);
    expect(placement(sent.state)).toBe(e4Board);
    const early = run(sent.state, [{ type: 'readAnswered', requestId: 1, snapshot: live }]);
    expect(early.effects).toEqual([{ kind: 'readGame', requestId: 3 }]);
    expect(placement(early.state)).toBe(e4Board);
    const landed = run(early.state, [
      { type: 'readAnswered', requestId: 3, snapshot: { ...afterE4, mode: 'live' } },
    ]);
    expect(landed.state.sync).toEqual({ kind: 'fresh', reading: null });
    expect(landed.state.message).toBe('Move accepted: e4. Black to move.');
  });

  it('ignores answers to requests it is not waiting on', () => {
    const staged = run(initialBoardState(start), playE4).state;
    expect(run(staged, [{ type: 'readAnswered', requestId: 9, snapshot: afterE5 }]).state).toBe(staged);
    expect(
      run(staged, [{ type: 'moveAnswered', requestId: 9, answer: { kind: 'unreachable' } }]).state,
    ).toBe(staged);
    expect(run(staged, [{ type: 'undoWindowEnded', clientCommandId: 'other' }]).state).toBe(staged);
  });

  it('slides and sounds a new ply, not a version bump', () => {
    const opened = run(initialBoardState(afterE4), [
      { type: 'reconcileWanted', background: true },
      { type: 'readAnswered', requestId: 1, snapshot: { ...afterE4, version: 2 } },
    ]);
    expect(opened.effects.some((effect) => effect.kind === 'playSound')).toBe(false);
    const arrived = run(opened.state, [
      { type: 'reconcileWanted', background: true },
      { type: 'readAnswered', requestId: 2, snapshot: { ...afterE5, version: 3 } },
    ]);
    expect(arrived.effects).toContainEqual({ kind: 'playSound', san: 'e5' });
  });
});
