import type { ChessMoveProposal, ChessSquare, SideToMove } from '@between-moves/domain';
import { parseFenPieces, type Fen } from './board-model';
import type { BoardSlide, PromotionPiece } from './chess-board';
import { legalMoves, proposalOutcome, type LegalMoves } from './legal-moves';
import type { MoveAnswer, MoveEntryPosition } from './move-entry-wire';

/** A correspondence Move waits this long before it is sent, so a slip can be taken back. */
export const UNDO_WINDOW_MS = 5_000;

export const COULD_NOT_SYNC = 'Could not sync the Game. Refresh before moving.';
const SAVED_NOT_REFRESHED = 'The Move was saved, but the full Game could not be refreshed.';
const NOT_SAVED = "Something went wrong. Your last change wasn't saved — try again.";

export interface SubmitCommand {
  readonly proposal: ChessMoveProposal;
  readonly expectedPly: number;
  readonly clientCommandId: string;
}

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'piece'; readonly from: ChessSquare }
  | { readonly kind: 'promotion'; readonly from: ChessSquare; readonly to: ChessSquare };

/** A board the server reported, with the version and ply it belongs to. */
export interface KnownBoard {
  readonly version: number;
  readonly ply: number;
  readonly fen: Fen;
  readonly sideToMove: SideToMove;
  /** The Move that led here, as its from and to squares. */
  readonly lastMove: string | null;
}

export type Command =
  | { readonly kind: 'none' }
  | { readonly kind: 'staged'; readonly command: SubmitCommand; readonly san: string }
  | { readonly kind: 'sending'; readonly command: SubmitCommand; readonly requestId: number }
  /** The send did not reach the server; Try again sends the same command. */
  | { readonly kind: 'retryable'; readonly command: SubmitCommand };

/** What to tell the player once the read after an accepted Move or a flag fall settles. */
type Settle = { readonly kind: 'accepted'; readonly san: string } | { readonly kind: 'flag' };

/**
 * Whether the snapshot can be trusted. `reading` is the one current read of the Game; an answer to
 * an earlier read still applies when it is newer than the snapshot. `ahead` is a board from a Move
 * answer that the snapshot does not have yet; only a read that lands at its version or later
 * clears it, so a fresh board never has one.
 */
export type Sync =
  | { readonly kind: 'fresh'; readonly reading: number | null }
  | {
      readonly kind: 'stale';
      readonly reading: number;
      readonly background: boolean;
      readonly settle: Settle | null;
      readonly ahead: KnownBoard | null;
    }
  | { readonly kind: 'failed'; readonly ahead: KnownBoard | null };

export interface BoardState {
  readonly live: boolean;
  readonly startedActive: boolean;
  /** The newest full Game snapshot. */
  readonly snapshot: MoveEntryPosition;
  readonly sync: Sync;
  readonly command: Command;
  readonly nextRequestId: number;
  readonly selection: Selection;
  readonly reviewPly: number | null;
  readonly slide: BoardSlide | null;
  /** The ply of the player's own Move that already slid, so its arrival does not slide again. */
  readonly ownSlidePly: number | null;
  readonly message: string;
  readonly alert: string;
  readonly offlineBannerDismissed: boolean;
}

export interface Environment {
  readonly online: boolean;
  readonly visible: boolean;
  /** Live play needs a viewport at least 768 px wide. */
  readonly wideEnough: boolean;
}

export type BoardEvent =
  | { readonly type: 'squareTapped'; readonly square: ChessSquare; readonly commandId: string }
  | { readonly type: 'dragStarted'; readonly square: ChessSquare }
  | {
      readonly type: 'pieceDropped';
      readonly from: ChessSquare;
      readonly to: ChessSquare | null;
      readonly commandId: string;
    }
  | { readonly type: 'promotionChosen'; readonly piece: PromotionPiece; readonly commandId: string }
  | { readonly type: 'promotionCancelled' }
  | { readonly type: 'undoPressed' }
  | { readonly type: 'undoWindowEnded'; readonly clientCommandId: string }
  | { readonly type: 'pageHidden' }
  | { readonly type: 'retryPressed' }
  /** Refresh board, or a draw or resign command settled. */
  | { readonly type: 'refreshRequested' }
  /** Focus, a poll, or a realtime event. */
  | { readonly type: 'reconcileWanted'; readonly background: boolean }
  /** `snapshot` is null when the read failed or its body was not a Game this board can use. */
  | {
      readonly type: 'readAnswered';
      readonly requestId: number;
      readonly snapshot: MoveEntryPosition | null;
    }
  | { readonly type: 'moveAnswered'; readonly requestId: number; readonly answer: MoveAnswer }
  | { readonly type: 'reviewShown'; readonly ply: number | null }
  | { readonly type: 'reviewStepped'; readonly step: 'previous' | 'next' }
  | { readonly type: 'offlineBannerDismissed' };

export type BoardEffect =
  | { readonly kind: 'readGame'; readonly requestId: number }
  | {
      readonly kind: 'sendMove';
      readonly requestId: number;
      readonly command: SubmitCommand;
      readonly keepalive: boolean;
    }
  | { readonly kind: 'startUndoTimer'; readonly clientCommandId: string }
  | { readonly kind: 'playSound'; readonly san: string };

type Step = readonly [BoardState, readonly BoardEffect[]];

const noSelection: Selection = { kind: 'none' };
const noCommand: Command = { kind: 'none' };
const noSquares: ReadonlySet<ChessSquare> = new Set();

export function initialBoardState(initial: MoveEntryPosition): BoardState {
  return {
    live: initial.mode === 'live',
    startedActive: initial.state === 'active',
    snapshot: initial,
    sync: { kind: 'fresh', reading: null },
    command: noCommand,
    nextRequestId: 1,
    selection: noSelection,
    reviewPly: null,
    slide: null,
    ownSlidePly: null,
    message: '',
    alert: '',
    offlineBannerDismissed: false,
  };
}

export function turnLabel(side: SideToMove): string {
  return side === 'white' ? 'White to move' : 'Black to move';
}

function aheadOf(sync: Sync): KnownBoard | null {
  return sync.kind === 'fresh' ? null : sync.ahead;
}

function readingOf(sync: Sync): number | null {
  return sync.kind === 'failed' ? null : sync.reading;
}

/** The newest board this client knows: a Move answer's board, or the snapshot's. */
export function liveBoard(state: BoardState): KnownBoard {
  const ahead = aheadOf(state.sync);
  if (ahead !== null) return ahead;
  const { snapshot } = state;
  return {
    version: snapshot.version,
    ply: snapshot.currentPly,
    fen: snapshot.currentFen,
    sideToMove: snapshot.sideToMove,
    lastMove: snapshot.moves.at(-1)?.uci.slice(0, 4) ?? null,
  };
}

/** A staged or sending Move, which the board shows until it is answered or taken back. */
export function pendingCommand(state: BoardState): SubmitCommand | null {
  return state.command.kind === 'staged' || state.command.kind === 'sending'
    ? state.command.command
    : null;
}

export function reviewing(state: BoardState, positions: readonly Fen[] | null): boolean {
  return (
    state.reviewPly !== null && positions !== null && state.reviewPly < state.snapshot.moves.length
  );
}

/**
 * The one position the board draws: the reviewed one, else a pending Move on the newest board,
 * else the newest board. `positions` is the replay from `replayPositions`.
 */
export function shownPosition(
  state: BoardState,
  positions: readonly Fen[] | null,
): { readonly fen: Fen; readonly lastMove: string | null } {
  if (positions !== null && reviewing(state, positions)) {
    const ply = state.reviewPly!;
    return {
      fen: positions[ply]!,
      lastMove: ply === 0 ? null : (state.snapshot.moves[ply - 1]?.uci.slice(0, 4) ?? null),
    };
  }
  const live = liveBoard(state);
  const pending = pendingCommand(state);
  if (pending !== null && pending.expectedPly === live.ply) {
    const outcome = proposalOutcome(live.fen, pending.proposal);
    if (outcome !== null) {
      return { fen: outcome.fen, lastMove: `${pending.proposal.from}${pending.proposal.to}` };
    }
  }
  return { fen: live.fen, lastMove: live.lastMove };
}

export function canMove(state: BoardState, env: Pick<Environment, 'online' | 'wideEnough'>) {
  const { snapshot } = state;
  return (
    (!state.live || env.wideEnough) &&
    state.sync.kind === 'fresh' &&
    snapshot.state === 'active' &&
    snapshot.viewerColor === snapshot.sideToMove &&
    state.command.kind !== 'staged' &&
    env.online
  );
}

/** The player's pieces that have a legal Move, when the board takes one. */
export function movableSquares(
  state: BoardState,
  env: Pick<Environment, 'online' | 'wideEnough'>,
  legal: LegalMoves,
): ReadonlySet<ChessSquare> {
  if (!canMove(state, env) || state.command.kind === 'sending') return noSquares;
  const pieces = parseFenPieces(liveBoard(state).fen);
  return new Set(
    [...legal.keys()].filter((square) => pieces[square]?.color === state.snapshot.viewerColor),
  );
}

function pick(state: BoardState, square: ChessSquare, legal: LegalMoves): BoardState {
  const count = legal.get(square)?.size ?? 0;
  return {
    ...state,
    selection: { kind: 'piece', from: square },
    message: `${square} selected. ${count === 1 ? '1 legal move' : `${count} legal moves`}.`,
  };
}

function startRead(state: BoardState, background: boolean): Step {
  if (readingOf(state.sync) !== null) return [state, []];
  const requestId = state.nextRequestId;
  const sync: Sync =
    background && state.sync.kind === 'fresh'
      ? { kind: 'fresh', reading: requestId }
      : {
          kind: 'stale',
          reading: requestId,
          background,
          settle: null,
          ahead: aheadOf(state.sync),
        };
  return [{ ...state, nextRequestId: requestId + 1, sync }, [{ kind: 'readGame', requestId }]];
}

/** After a Move answer the board reads the Game again at once; a read already out becomes earlier. */
function readAfterAnswer(state: BoardState, ahead: KnownBoard | null, settle: Settle | null): Step {
  const kept = ahead !== null && ahead.version > state.snapshot.version ? ahead : null;
  const requestId = state.nextRequestId;
  return [
    {
      ...state,
      nextRequestId: requestId + 1,
      sync: { kind: 'stale', reading: requestId, background: false, settle, ahead: kept },
    },
    [{ kind: 'readGame', requestId }],
  ];
}

function send(
  state: BoardState,
  command: SubmitCommand,
  keepalive: boolean,
  env: Environment,
): Step {
  if (state.command.kind === 'sending' || (state.live && !env.wideEnough)) return [state, []];
  const requestId = state.nextRequestId;
  return [
    {
      ...state,
      nextRequestId: requestId + 1,
      command: { kind: 'sending', command, requestId },
      alert: '',
      message: `Sending ${command.proposal.from} to ${command.proposal.to}.`,
    },
    [{ kind: 'sendMove', requestId, command, keepalive }],
  ];
}

function commit(
  state: BoardState,
  proposal: ChessMoveProposal,
  via: 'tap' | 'drag' | 'promotion',
  commandId: string,
  env: Environment,
): Step {
  const live = liveBoard(state);
  const command: SubmitCommand = { proposal, expectedPly: live.ply, clientCommandId: commandId };
  const san = proposalOutcome(live.fen, proposal)?.san ?? `${proposal.from}-${proposal.to}`;
  const played: BoardState = {
    ...state,
    selection: noSelection,
    reviewPly: null,
    ownSlidePly: live.ply + 1,
    slide:
      via === 'drag' ? null : { key: `own:${commandId}`, from: proposal.from, to: proposal.to },
  };
  const sound: BoardEffect = { kind: 'playSound', san };
  if (state.live) {
    const [sent, effects] = send(played, command, false, env);
    return [sent, [sound, ...effects]];
  }
  return [
    {
      ...played,
      command: { kind: 'staged', command, san },
      message: `You played ${san}. It sends in five seconds unless you press Undo.`,
    },
    [sound, { kind: 'startUndoTimer', clientCommandId: commandId }],
  ];
}

/** A legal destination plays at once; a promotion asks first. Null when `to` is not legal. */
function play(
  state: BoardState,
  from: ChessSquare,
  to: ChessSquare,
  via: 'tap' | 'drag',
  commandId: string,
  env: Environment,
  legal: LegalMoves,
): Step | null {
  const promotes = legal.get(from)?.get(to);
  if (promotes === undefined) return null;
  if (promotes) {
    return [
      {
        ...state,
        selection: { kind: 'promotion', from, to },
        message: 'Choose the piece your pawn becomes.',
      },
      [],
    ];
  }
  return commit(state, { from, to }, via, commandId, env);
}

function tapSquare(
  state: BoardState,
  square: ChessSquare,
  commandId: string,
  env: Environment,
): Step {
  if (!canMove(state, env) || state.command.kind === 'sending') return [state, []];
  const legal = legalMoves(liveBoard(state).fen);
  const cleared: BoardState = {
    ...state,
    alert: '',
    command: state.command.kind === 'retryable' ? noCommand : state.command,
  };
  const { selection } = cleared;
  if (selection.kind === 'piece') {
    if (square === selection.from) {
      return [{ ...cleared, selection: noSelection, message: 'Selection cleared.' }, []];
    }
    const played = play(cleared, selection.from, square, 'tap', commandId, env, legal);
    if (played !== null) return played;
  }
  if (movableSquares(cleared, env, legal).has(square)) return [pick(cleared, square, legal), []];
  const own = parseFenPieces(liveBoard(state).fen)[square]?.color === state.snapshot.viewerColor;
  return [
    {
      ...cleared,
      selection: noSelection,
      message: own ? `The piece on ${square} has no legal move.` : 'Choose one of your pieces.',
    },
    [],
  ];
}

function releaseStaged(state: BoardState, keepalive: boolean, env: Environment): Step {
  if (state.command.kind !== 'staged') return [state, []];
  return send({ ...state, command: noCommand }, state.command.command, keepalive, env);
}

function knownVersion(state: BoardState): number {
  return liveBoard(state).version;
}

/** Takes in a newer full snapshot: drops a stale selection or retry, and slides a new arrival. */
function applySnapshot(state: BoardState, snapshot: MoveEntryPosition, background: boolean): Step {
  const versionMoved = snapshot.version !== knownVersion(state);
  let next: BoardState = { ...state, snapshot };
  if (!background || versionMoved) {
    next = {
      ...next,
      selection: noSelection,
      command: next.command.kind === 'retryable' ? noCommand : next.command,
    };
  }
  const arrived = snapshot.moves.at(-1);
  // Draw offers and resignations move the version too; only a new ply is an arrival.
  if (
    arrived === undefined ||
    arrived.ply <= state.snapshot.currentPly ||
    arrived.ply === state.ownSlidePly
  ) {
    return [next, []];
  }
  return [
    {
      ...next,
      slide: {
        key: `${arrived.ply}:${arrived.uci}`,
        from: arrived.uci.slice(0, 2) as ChessSquare,
        to: arrived.uci.slice(2, 4) as ChessSquare,
        san: arrived.san,
      },
    },
    [{ kind: 'playSound', san: arrived.san }],
  ];
}

function readAnswered(
  state: BoardState,
  requestId: number,
  answer: MoveEntryPosition | null,
): Step {
  const { sync } = state;
  const snapshot = answer !== null && (!state.live || answer.mode === 'live') ? answer : null;
  if (sync.kind === 'failed' || sync.reading !== requestId) {
    if (snapshot === null || snapshot.version <= state.snapshot.version) return [state, []];
    const [applied, effects] = applySnapshot(state, snapshot, true);
    if (applied.sync.kind === 'fresh') return [applied, effects];
    const { ahead } = applied.sync;
    return [
      {
        ...applied,
        sync: {
          ...applied.sync,
          ahead: ahead !== null && ahead.version > snapshot.version ? ahead : null,
        },
      },
      effects,
    ];
  }
  const background = sync.kind === 'fresh' || sync.background;
  const settle = sync.kind === 'stale' ? sync.settle : null;
  const ahead = aheadOf(sync);
  if (snapshot === null || (ahead !== null && snapshot.version < ahead.version)) {
    const failed: BoardState = {
      ...state,
      sync: { kind: 'failed', ahead: aheadOf(sync) },
      alert: COULD_NOT_SYNC,
    };
    if (settle === null) return [failed, []];
    return [
      settle.kind === 'accepted'
        ? {
            ...failed,
            message: `Move accepted: ${settle.san}. Refresh the Game before moving again.`,
            alert: SAVED_NOT_REFRESHED,
          }
        : {
            ...failed,
            message: 'Time expired. Refresh the Game.',
            alert: 'The Game completed, but the board could not be refreshed.',
          },
      [],
    ];
  }

  // An earlier read can already have brought a newer snapshot than this one.
  const [applied, effects] =
    snapshot.version >= state.snapshot.version
      ? applySnapshot(state, snapshot, background)
      : [state, []];
  const newest = applied.snapshot;
  const landed: BoardState = {
    ...applied,
    sync: { kind: 'fresh', reading: null },
    alert:
      applied.alert === SAVED_NOT_REFRESHED || applied.alert === COULD_NOT_SYNC
        ? ''
        : applied.alert,
  };
  if (settle === null) return [landed, effects];
  return [
    {
      ...landed,
      message:
        settle.kind === 'flag'
          ? 'Time expired. Game complete.'
          : newest.state === 'completed'
            ? `Move accepted: ${settle.san}. Game complete.`
            : `Move accepted: ${settle.san}. ${turnLabel(newest.sideToMove)}.`,
    },
    effects,
  ];
}

function moveAnswered(state: BoardState, requestId: number, answer: MoveAnswer): Step {
  const { command } = state;
  if (command.kind !== 'sending' || command.requestId !== requestId) return [state, []];
  const answered: BoardState = { ...state, command: noCommand };
  const ahead = aheadOf(state.sync);
  switch (answer.kind) {
    case 'accepted': {
      const { move } = answer;
      const cleared: BoardState = { ...answered, selection: noSelection };
      // A retried command can return its first answer after the Game moved on; keep the newer board.
      if (move.version <= knownVersion(state)) {
        return readAfterAnswer(cleared, ahead, { kind: 'accepted', san: move.san });
      }
      if (state.live) {
        // The live snapshot carries clocks the answer does not, so it waits for the read.
        return readAfterAnswer(
          cleared,
          {
            version: move.version,
            ply: move.ply,
            fen: move.fenAfter,
            sideToMove: move.sideToMove,
            lastMove: move.uci.slice(0, 4),
          },
          { kind: 'accepted', san: move.san },
        );
      }
      const { snapshot } = cleared;
      return readAfterAnswer(
        {
          ...cleared,
          snapshot: {
            ...snapshot,
            currentFen: move.fenAfter,
            currentPly: move.ply,
            sideToMove: move.sideToMove,
            version: move.version,
            moves: [...snapshot.moves, { ply: move.ply, uci: move.uci, san: move.san }],
          },
        },
        ahead,
        { kind: 'accepted', san: move.san },
      );
    }
    case 'flagFall':
      return readAfterAnswer({ ...answered, selection: noSelection }, ahead, { kind: 'flag' });
    case 'conflict': {
      const { position } = answer;
      const conflicted: BoardState = {
        ...answered,
        ownSlidePly: null,
        selection: noSelection,
        alert:
          position === null
            ? "That Game changed. Here's the latest board."
            : "That position moved on. Here's the latest board.",
      };
      if (position === null || position.version <= knownVersion(state)) {
        return readAfterAnswer(conflicted, ahead, null);
      }
      return readAfterAnswer(
        conflicted,
        {
          version: position.version,
          ply: position.currentPly,
          fen: position.currentFen,
          sideToMove: position.sideToMove,
          lastMove: null,
        },
        null,
      );
    }
    case 'rejected':
      return [
        {
          ...answered,
          selection: noSelection,
          ownSlidePly: null,
          alert: answer.illegal
            ? 'That Move is not legal from the current position. Choose another Move.'
            : NOT_SAVED,
        },
        [],
      ];
    case 'unreachable':
      return [
        { ...answered, command: { kind: 'retryable', command: command.command }, alert: NOT_SAVED },
        [],
      ];
  }
}

/** Every board event goes through here, and only here decides whether a late answer applies. */
export function transition(state: BoardState, event: BoardEvent, env: Environment): Step {
  switch (event.type) {
    case 'squareTapped':
      return tapSquare(state, event.square, event.commandId, env);
    case 'dragStarted': {
      const { selection } = state;
      if (selection.kind === 'piece' && selection.from === event.square) return [state, []];
      return [pick(state, event.square, legalMoves(liveBoard(state).fen)), []];
    }
    case 'pieceDropped': {
      if (!canMove(state, env) || state.command.kind === 'sending') return [state, []];
      const legal = legalMoves(liveBoard(state).fen);
      if (event.to !== null && event.to !== event.from) {
        const played = play(state, event.from, event.to, 'drag', event.commandId, env, legal);
        if (played !== null) return played;
      }
      return [pick(state, event.from, legal), []];
    }
    case 'promotionChosen': {
      const { selection } = state;
      if (selection.kind !== 'promotion') return [state, []];
      const proposal = { from: selection.from, to: selection.to, promotion: event.piece };
      return commit(state, proposal, 'promotion', event.commandId, env);
    }
    case 'promotionCancelled': {
      const { selection } = state;
      if (selection.kind !== 'promotion') return [state, []];
      return [pick(state, selection.from, legalMoves(liveBoard(state).fen)), []];
    }
    case 'undoPressed': {
      if (state.command.kind !== 'staged') return [state, []];
      return [
        {
          ...state,
          command: noCommand,
          ownSlidePly: null,
          slide: null,
          message: `${state.command.san} taken back. Your move.`,
        },
        [],
      ];
    }
    case 'undoWindowEnded':
      if (
        state.command.kind !== 'staged' ||
        state.command.command.clientCommandId !== event.clientCommandId
      ) {
        return [state, []];
      }
      return releaseStaged(state, false, env);
    case 'pageHidden':
      return releaseStaged(state, true, env);
    case 'retryPressed':
      if (state.command.kind !== 'retryable' || !env.online) return [state, []];
      return send(state, state.command.command, false, env);
    case 'refreshRequested':
      return startRead(state, false);
    case 'reconcileWanted':
      if (!env.visible || !env.online || pendingCommand(state) !== null) return [state, []];
      return startRead(state, event.background);
    case 'readAnswered':
      return readAnswered(state, event.requestId, event.snapshot);
    case 'moveAnswered':
      return moveAnswered(state, event.requestId, event.answer);
    case 'reviewShown': {
      const end = state.snapshot.moves.length;
      return [{ ...state, reviewPly: event.ply === end ? null : event.ply }, []];
    }
    case 'reviewStepped': {
      const end = state.snapshot.moves.length;
      const current = state.reviewPly;
      const reviewPly =
        event.step === 'previous'
          ? Math.max(0, (current ?? end) - 1)
          : current === null || current + 1 >= end
            ? null
            : current + 1;
      return [{ ...state, reviewPly }, []];
    }
    case 'offlineBannerDismissed':
      return [{ ...state, offlineBannerDismissed: true }, []];
  }
}
