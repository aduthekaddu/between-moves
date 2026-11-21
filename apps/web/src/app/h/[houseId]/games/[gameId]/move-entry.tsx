'use client';

import {
  isGameRealtimeTopic,
  type ChessMoveProposal,
  type ChessSquare,
  type GamePositionMove,
  type SideToMove,
} from '@between-moves/domain';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Piece } from '../../../../_components/piece';
import { parseFenPieces, type BoardPieces } from './board-model';
import { useBoardSound } from './board-sound';
import { boardStatus } from './board-status';
import { ChessBoard, type BoardSlide, type PromotionPiece } from './chess-board';
import { generateClientCommandId } from './client-command-id';
import { dueLabel, useMinuteClock } from './due-label';
import { GameActions } from './game-actions';
import { GameEnd, type RematchOffer } from './game-end';
import { endingHeadline } from './game-ending';
import { moveLabel, replayPositions, STANDARD_START } from './game-review';
import { legalMoves, proposalOutcome, turnState } from './legal-moves';
import { LiveClocks } from './live/live-clocks';
import { materialBalance } from './material';
import {
  acceptedMove,
  conflictPosition,
  flagFall,
  moveEntryPosition,
  type MoveEntryPosition,
} from './move-entry-wire';

interface SubmitCommand {
  readonly proposal: ChessMoveProposal;
  readonly expectedPly: number;
  readonly clientCommandId: string;
}

/** An open correspondence board re-reads the canonical Game this often while visible. */
const CORRESPONDENCE_REFRESH_MS = 60_000;

/** A correspondence Move waits this long before it is sent, so a slip can be taken back. */
export const UNDO_WINDOW_MS = 5_000;

type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'piece'; readonly from: ChessSquare }
  | { readonly kind: 'promotion'; readonly from: ChessSquare; readonly to: ChessSquare };

interface StagedMove {
  readonly command: SubmitCommand;
  readonly san: string;
}

/** One position as the board draws it, so its pieces and marks always agree. */
interface BoardView {
  readonly fen: string;
  readonly pieces: BoardPieces;
  readonly sideToMove: SideToMove;
  readonly inCheck: boolean;
  /** The Move that led here, as its from and to squares. */
  readonly lastMove: string | null;
}

/** Throws on a FEN it cannot read, so callers parse server boards inside their error handling. */
function boardView(fen: string, lastMove: string | null): BoardView {
  return { fen, pieces: parseFenPieces(fen), ...turnState(fen), lastMove };
}

function lastPlayed(moves: readonly GamePositionMove[]): string | null {
  return moves.at(-1)?.uci.slice(0, 4) ?? null;
}

/** Where a pending Move most likely leads, until the server answers. */
function pendingBoard(base: BoardView, proposal: ChessMoveProposal): BoardView {
  const outcome = proposalOutcome(base.fen, proposal);
  return outcome === null ? base : boardView(outcome.fen, `${proposal.from}${proposal.to}`);
}

const noSelection: Selection = { kind: 'none' };
const noSquares: ReadonlySet<ChessSquare> = new Set();

function turnLabel(side: SideToMove): string {
  return side === 'white' ? 'White to move' : 'Black to move';
}

function subscribeToConnectivity(change: () => void): () => void {
  const wentOffline = () => change();
  const cameOnline = () => {
    change();
    window.location.reload();
  };
  window.addEventListener('offline', wentOffline);
  window.addEventListener('online', cameOnline);
  return () => {
    window.removeEventListener('offline', wentOffline);
    window.removeEventListener('online', cameOnline);
  };
}

function subscribeToLiveViewport(change: () => void): () => void {
  const query = window.matchMedia('(min-width: 768px)');
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** [BM-027] [BM-042] Proposals and clocks reconcile from authoritative server snapshots. */
export function MoveEntry({
  houseId,
  gameId,
  initial,
  afterGame,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly initial: MoveEntryPosition;
  /** What the finished Game can lead to; the server reads it once with the page. */
  readonly afterGame?: {
    readonly perMoveHours: number | null;
    readonly incomingRematch: RematchOffer | null;
  };
}) {
  const [position, setPosition] = useState(initial);
  const [startedActive] = useState(initial.state === 'active');
  const router = useRouter();
  const sound = useBoardSound();
  const now = useMinuteClock();
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const positions = useMemo(
    () => replayPositions(position.moves, position.currentFen),
    [position.currentFen, position.moves],
  );
  const live = initial.mode === 'live';
  const liveViewport = useSyncExternalStore(
    subscribeToLiveViewport,
    () => window.matchMedia('(min-width: 768px)').matches,
    () => true,
  );
  const refreshRequest = useRef<{
    controller: AbortController;
    promise: Promise<MoveEntryPosition | null>;
  } | null>(null);
  const commandInFlight = useRef(false);
  const positionVersion = useRef(initial.version);
  const positionPly = useRef(initial.currentPly);
  const [canonical, setCanonical] = useState(() =>
    boardView(initial.currentFen, lastPlayed(initial.moves)),
  );
  const [shown, setShown] = useState(canonical);
  const [selection, setSelection] = useState<Selection>(noSelection);
  const [staged, setStaged] = useState<StagedMove | null>(null);
  const stagedRef = useRef<StagedMove | null>(null);
  const [slide, setSlide] = useState<BoardSlide | null>(null);
  const ownSlidePly = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [canonicalFresh, setCanonicalFresh] = useState(true);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    () => !navigator.onLine,
    () => false,
  );
  const [message, setMessage] = useState('');
  const [alert, setAlert] = useState('');
  const [retry, setRetry] = useState<SubmitCommand | null>(null);

  const canMove =
    (!live || liveViewport) &&
    canonicalFresh &&
    position.state === 'active' &&
    position.viewerColor === position.sideToMove &&
    staged === null &&
    !offline;
  const legal = useMemo(() => legalMoves(position.currentFen), [position.currentFen]);
  const movable = useMemo<ReadonlySet<ChessSquare>>(
    () =>
      canMove && !pending
        ? new Set(
            [...legal.keys()].filter(
              (square) => canonical.pieces[square]?.color === position.viewerColor,
            ),
          )
        : noSquares,
    [canMove, canonical.pieces, legal, pending, position.viewerColor],
  );
  const selectedFrom = selection.kind === 'none' ? null : selection.from;
  const targets = useMemo<ReadonlySet<ChessSquare>>(
    () =>
      selection.kind === 'piece'
        ? new Set((legal.get(selection.from) ?? new Map()).keys())
        : noSquares,
    [legal, selection],
  );

  function clearSelection() {
    setSelection(noSelection);
  }

  function pick(square: ChessSquare) {
    const count = legal.get(square)?.size ?? 0;
    setSelection({ kind: 'piece', from: square });
    setMessage(`${square} selected. ${count === 1 ? '1 legal move' : `${count} legal moves`}.`);
  }

  /** Every gesture ends here: a legal destination plays at once, a promotion asks first. */
  function play(from: ChessSquare, to: ChessSquare, via: 'tap' | 'drag') {
    const promotes = legal.get(from)?.get(to);
    if (promotes === undefined) return false;
    if (promotes) {
      setSelection({ kind: 'promotion', from, to });
      setMessage('Choose the piece your pawn becomes.');
      return true;
    }
    commit({ from, to }, via);
    return true;
  }

  function tapSquare(square: ChessSquare) {
    if (!canMove || pending) return;
    setAlert('');
    setRetry(null);
    if (selection.kind === 'piece') {
      if (square === selection.from) {
        clearSelection();
        setMessage('Selection cleared.');
        return;
      }
      if (play(selection.from, square, 'tap')) return;
    }
    if (movable.has(square)) {
      pick(square);
      return;
    }
    clearSelection();
    setMessage(
      canonical.pieces[square]?.color === position.viewerColor
        ? `The piece on ${square} has no legal move.`
        : 'Choose one of your pieces.',
    );
  }

  function dropPiece(from: ChessSquare, to: ChessSquare | null) {
    if (!canMove || pending) return;
    if (to !== null && to !== from && play(from, to, 'drag')) return;
    pick(from);
  }

  function commit(proposal: ChessMoveProposal, via: 'tap' | 'drag' | 'promotion') {
    const command: SubmitCommand = {
      proposal,
      expectedPly: position.currentPly,
      clientCommandId: generateClientCommandId(),
    };
    const outcome = proposalOutcome(position.currentFen, proposal);
    const san = outcome?.san ?? `${proposal.from}-${proposal.to}`;
    clearSelection();
    setReviewPly(null);
    sound.play(san);
    ownSlidePly.current = position.currentPly + 1;
    setSlide(
      via === 'drag'
        ? null
        : { key: `own:${command.clientCommandId}`, from: proposal.from, to: proposal.to },
    );
    if (live) {
      void sendMove(command);
      return;
    }
    // A refresh already on its way would redraw the board without the staged Move.
    refreshRequest.current?.controller.abort();
    refreshRequest.current = null;
    const next = { command, san };
    stagedRef.current = next;
    setStaged(next);
    setShown(pendingBoard(canonical, proposal));
    setMessage(`You played ${san}. It sends in five seconds unless you press Undo.`);
  }

  function undoStaged() {
    const current = stagedRef.current;
    if (current === null) return;
    stagedRef.current = null;
    setStaged(null);
    ownSlidePly.current = null;
    setSlide(null);
    setShown(canonical);
    setMessage(`${current.san} taken back. Your move.`);
  }

  const releaseStaged = useEffectEvent((keepalive: boolean) => {
    const current = stagedRef.current;
    if (current === null) return;
    stagedRef.current = null;
    setStaged(null);
    void sendMove(current.command, keepalive);
  });

  const playArrival = useEffectEvent((san: string) => sound.play(san));
  useEffect(() => {
    if (slide?.san !== undefined) playArrival(slide.san);
  }, [slide]);

  useEffect(() => {
    if (staged === null) return;
    const timer = setTimeout(() => releaseStaged(false), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [staged]);

  useEffect(() => {
    // A staged Move must not be lost when the reader leaves: send it as the page goes away.
    const sendNowIfHidden = () => {
      if (document.visibilityState === 'hidden') releaseStaged(true);
    };
    const sendNow = () => releaseStaged(true);
    document.addEventListener('visibilitychange', sendNowIfHidden);
    window.addEventListener('pagehide', sendNow);
    return () => {
      document.removeEventListener('visibilitychange', sendNowIfHidden);
      window.removeEventListener('pagehide', sendNow);
      releaseStaged(true);
    };
  }, []);

  const refreshCanonicalPosition = useCallback(
    (background = false): Promise<MoveEntryPosition | null> => {
      if (refreshRequest.current !== null) return refreshRequest.current.promise;
      const controller = new AbortController();
      if (!background) setCanonicalFresh(false);
      setRefreshNeeded(false);
      const promise = (async () => {
        try {
          const response = await fetch(
            `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`,
            {
              cache: 'no-store',
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            },
          );
          const body: unknown = await response.json();
          const refreshed = response.ok ? moveEntryPosition(body) : null;
          if (refreshed === null || (live && refreshed.mode !== 'live')) {
            throw new Error('Canonical Game response is invalid');
          }
          if (controller.signal.aborted) return null;
          if (refreshed.version < positionVersion.current) throw new Error('Stale Game snapshot');
          const board = boardView(refreshed.currentFen, lastPlayed(refreshed.moves));
          if (!background || refreshed.version !== positionVersion.current) {
            setSelection(noSelection);
            setRetry(null);
          }
          const arrived = refreshed.moves.at(-1);
          // Draw offers and resignations move the version too; only a new ply is an arrival.
          if (
            arrived !== undefined &&
            arrived.ply > positionPly.current &&
            arrived.ply !== ownSlidePly.current
          ) {
            setSlide({
              key: `${arrived.ply}:${arrived.uci}`,
              from: arrived.uci.slice(0, 2) as ChessSquare,
              to: arrived.uci.slice(2, 4) as ChessSquare,
              san: arrived.san,
            });
          }
          positionVersion.current = refreshed.version;
          positionPly.current = refreshed.currentPly;
          setPosition(refreshed);
          setCanonical(board);
          setShown(board);
          setCanonicalFresh(true);
          setAlert((current) =>
            current === 'The Move was saved, but the full Game could not be refreshed.' ||
            current === 'Could not sync the Game. Refresh before moving.'
              ? ''
              : current,
          );
          return refreshed;
        } catch {
          if (controller.signal.aborted) return null;
          setCanonicalFresh(false);
          setRefreshNeeded(true);
          setAlert('Could not sync the Game. Refresh before moving.');
          return null;
        } finally {
          if (refreshRequest.current?.controller === controller) refreshRequest.current = null;
        }
      })();
      refreshRequest.current = { controller, promise };
      return promise;
    },
    [gameId, houseId, live],
  );

  const reconcileCanonical = useEffectEvent((background: boolean) => {
    if (
      document.visibilityState === 'hidden' ||
      commandInFlight.current ||
      stagedRef.current !== null ||
      !navigator.onLine
    )
      return;
    void refreshCanonicalPosition(background);
  });

  useEffect(() => {
    if (!live) return;
    const refocus = () => reconcileCanonical(false);
    refocus(); // Replace the SSR snapshot after hydration, including any delivery delay.
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', refocus);
    const timer =
      position.state === 'active'
        ? window.setInterval(() => reconcileCanonical(true), 3000)
        : undefined;
    return () => {
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', refocus);
      window.clearInterval(timer);
      refreshRequest.current?.controller.abort();
      refreshRequest.current = null;
    };
  }, [live, position.state]);

  useEffect(() => {
    if (live || position.state !== 'active') return;
    // [BM-028] correspondence boards have no realtime channel: re-read when the reader comes
    // back to the tab, and now and then while it stays open, so offers and Moves appear
    const refocus = () => reconcileCanonical(true);
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', refocus);
    const timer = window.setInterval(refocus, CORRESPONDENCE_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', refocus);
      window.clearInterval(timer);
    };
  }, [live, position.state]);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let source: EventSource | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    const subscribe = async () => {
      source?.close();
      try {
        const response = await fetch(
          `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/realtime-token`,
          { method: 'POST' },
        );
        if (!response.ok) throw new Error('Game subscription unavailable');
        const issued: unknown = await response.json();
        if (
          issued === null ||
          typeof issued !== 'object' ||
          !('token' in issued) ||
          typeof issued.token !== 'string' ||
          !('channel' in issued) ||
          typeof issued.channel !== 'string' ||
          !('expiresAt' in issued) ||
          typeof issued.expiresAt !== 'string'
        ) {
          throw new Error('Game subscription invalid');
        }
        if (stopped) return;
        const channel = issued.channel;
        source = new EventSource(
          `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/live?token=${encodeURIComponent(issued.token)}`,
        );
        source.onopen = () => reconcileCanonical(true);
        source.onmessage = (event) => {
          try {
            const envelope: unknown = JSON.parse(event.data);
            if (
              envelope !== null &&
              typeof envelope === 'object' &&
              'channel' in envelope &&
              envelope.channel === channel &&
              'name' in envelope &&
              typeof envelope.name === 'string' &&
              isGameRealtimeTopic(envelope.name) &&
              'data' in envelope &&
              envelope.data !== null &&
              typeof envelope.data === 'object' &&
              'houseId' in envelope.data &&
              envelope.data.houseId === houseId &&
              'aggregateId' in envelope.data &&
              envelope.data.aggregateId === gameId
            ) {
              reconcileCanonical(true);
            }
          } catch {
            // The periodic canonical read repairs malformed or missing events.
          }
        };
        const delay = Math.max(1_000, Date.parse(issued.expiresAt) - Date.now() - 60_000);
        renewal = setTimeout(() => void subscribe(), delay);
      } catch {
        if (!stopped) renewal = setTimeout(() => void subscribe(), 30_000);
      }
    };
    void subscribe();
    return () => {
      stopped = true;
      source?.close();
      if (renewal !== undefined) clearTimeout(renewal);
    };
  }, [gameId, houseId, live]);

  const endedHere = startedActive && position.state === 'completed';
  useEffect(() => {
    // The server read the page around the board, such as the head-to-head line, before the end.
    if (endedHere) router.refresh();
  }, [endedHere, router]);

  async function sendMove(command: SubmitCommand, keepalive = false) {
    if (commandInFlight.current || (live && !liveViewport)) return;
    commandInFlight.current = true;
    refreshRequest.current?.controller.abort();
    refreshRequest.current = null;
    setPending(true);
    setAlert('');
    setRetry(null);
    setShown(pendingBoard(canonical, command.proposal));
    setMessage(`Sending ${command.proposal.from} to ${command.proposal.to}.`);
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/moves`,
        {
          method: 'POST',
          keepalive,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedPly: command.expectedPly,
            clientCommandId: command.clientCommandId,
            move: command.proposal,
          }),
        },
      );
      const body: unknown = await response.json();
      const accepted = response.ok ? acceptedMove(body) : null;
      if (accepted !== null) {
        positionVersion.current = accepted.version;
        const board = boardView(accepted.fenAfter, accepted.uci.slice(0, 4));
        setCanonical(board);
        setShown(board);
        setPosition((current) =>
          live
            ? current
            : {
                ...current,
                currentFen: accepted.fenAfter,
                currentPly: accepted.ply,
                sideToMove: accepted.sideToMove,
                version: accepted.version,
                moves: [
                  ...current.moves,
                  { ply: accepted.ply, uci: accepted.uci, san: accepted.san },
                ],
              },
        );
        clearSelection();
        setCanonicalFresh(false);
        const refreshed = await refreshCanonicalPosition();
        setMessage(
          refreshed !== null
            ? refreshed.state === 'completed'
              ? `Move accepted: ${accepted.san}. Game complete.`
              : `Move accepted: ${accepted.san}. ${turnLabel(refreshed.sideToMove)}.`
            : `Move accepted: ${accepted.san}. Refresh the Game before moving again.`,
        );
        if (refreshed === null) {
          setAlert('The Move was saved, but the full Game could not be refreshed.');
        }
        return;
      }

      if (response.ok && flagFall(body)) {
        setShown(canonical);
        clearSelection();
        setCanonicalFresh(false);
        const refreshed = await refreshCanonicalPosition();
        setMessage(
          refreshed === null ? 'Time expired. Refresh the Game.' : 'Time expired. Game complete.',
        );
        if (refreshed === null)
          setAlert('The Game completed, but the board could not be refreshed.');
        return;
      }

      if (response.status === 409) {
        ownSlidePly.current = null;
        const conflict = conflictPosition(body);
        if (conflict !== null) {
          const board = boardView(conflict.currentFen, null);
          setCanonical(board);
          setShown(board);
          setPosition((current) => (live ? current : { ...current, ...conflict }));
        } else {
          setShown(canonical);
        }
        clearSelection();
        setAlert(
          conflict === null
            ? "That Game changed. Here's the latest board."
            : "That position moved on. Here's the latest board.",
        );
        setCanonicalFresh(false);
        await refreshCanonicalPosition();
        return;
      }

      setShown(canonical);
      clearSelection();
      ownSlidePly.current = null;
      setAlert(
        response.status === 422
          ? 'That Move is not legal from the current position. Choose another Move.'
          : "Something went wrong. Your last change wasn't saved — try again.",
      );
    } catch {
      setShown(canonical);
      setRetry(command);
      setAlert("Something went wrong. Your last change wasn't saved — try again.");
    } finally {
      commandInFlight.current = false;
      setPending(false);
    }
  }

  const orientation = position.viewerColor ?? 'white';
  const flipped: SideToMove = orientation === 'white' ? 'black' : 'white';
  const reviewing = reviewPly !== null && positions !== null && reviewPly < position.moves.length;
  const board = reviewing
    ? reviewPly === 0
      ? boardView(STANDARD_START, null)
      : boardView(
          positions[reviewPly - 1] ?? STANDARD_START,
          position.moves[reviewPly - 1]?.uci.slice(0, 4) ?? null,
        )
    : shown;
  const balance = materialBalance(board.pieces);
  const status = boardStatus({
    position,
    fresh: canonicalFresh,
    narrowLive: live && !liveViewport,
    pending,
  });
  const viewerWon =
    position.viewerColor !== null && position.result === `${position.viewerColor}_win`;
  const celebrate = endedHere && viewerWon;
  const player =
    position.viewerColor === null
      ? null
      : {
          color: position.viewerColor,
          opponent: position[position.viewerColor === 'white' ? 'black' : 'white'],
        };

  function strip(color: SideToMove) {
    const side = balance[color];
    return (
      <div
        className="player-strip"
        data-side={color}
        data-to-move={(position.state === 'active' && position.sideToMove === color) || undefined}
      >
        <span className="player-strip__dot" aria-hidden="true" />
        <span className="player-strip__name">
          {position[color].name}
          {position.viewerColor === color ? (
            <span className="player-strip__you"> · you</span>
          ) : null}
        </span>
        <span
          className="player-strip__material"
          aria-label={side.lead > 0 ? `Ahead by ${side.lead}` : undefined}
          aria-hidden={side.lead > 0 ? undefined : true}
        >
          {side.ahead.map((kind, index) => (
            <Piece
              key={`${kind}-${index}`}
              className="player-strip__piece"
              color={color === 'white' ? 'black' : 'white'}
              kind={kind}
            />
          ))}
          {side.lead > 0 ? <span className="player-strip__lead">+{side.lead}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <section className="move-entry" aria-labelledby="board-heading">
      <h2 id="board-heading" className="visually-hidden">
        Game board
      </h2>

      {offline && !offlineBannerDismissed ? (
        <div className="move-entry__banner" role="alert">
          <span>{"You're offline. We'll reconnect and refresh the board."}</span>
          <button type="button" onClick={() => setOfflineBannerDismissed(true)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {alert === '' ? null : (
        <div className="move-entry__banner" role="alert">
          <span>{alert}</span>
          {retry === null ? null : (
            <button
              type="button"
              onClick={() => void sendMove(retry)}
              disabled={pending || offline || (live && !liveViewport)}
            >
              Try again
            </button>
          )}
          {!refreshNeeded ? null : (
            <button type="button" onClick={() => void refreshCanonicalPosition()}>
              Refresh board
            </button>
          )}
        </div>
      )}

      {live ? (
        <LiveClocks key={`${position.serverNow}:${position.version}`} position={position} />
      ) : null}
      {live && !liveViewport ? (
        <p className="game-live-notice">
          Live play needs a screen at least 768 px wide. You can follow the Game here.
        </p>
      ) : null}

      <div className="board-stack" data-reviewing={reviewing || undefined}>
        {strip(flipped)}
        {reviewing ? (
          <div className="board-review" role="status">
            <span>
              {reviewPly === 0
                ? 'The starting position'
                : `After ${moveLabel(position.moves[reviewPly - 1]!)}`}
            </span>
            <button type="button" onClick={() => setReviewPly(null)}>
              Back to the game
            </button>
          </div>
        ) : null}
        <ChessBoard
          pieces={board.pieces}
          orientation={orientation}
          sideToMove={board.sideToMove}
          active={position.state === 'active'}
          lastMove={board.lastMove}
          inCheck={board.inCheck}
          selected={reviewing ? null : selectedFrom}
          targets={reviewing ? noSquares : targets}
          movable={reviewing ? noSquares : movable}
          disabled={reviewing || !canMove || pending}
          pending={pending}
          slide={reviewing ? null : slide}
          promotion={
            !reviewing && selection.kind === 'promotion' && position.viewerColor !== null
              ? { color: position.viewerColor }
              : null
          }
          onSquare={(square) => {
            sound.wake();
            tapSquare(square);
          }}
          onDragStart={(square) => {
            sound.wake();
            if (selection.kind !== 'piece' || selection.from !== square) pick(square);
          }}
          onDrop={dropPiece}
          onPromote={(piece: PromotionPiece) => {
            if (selection.kind !== 'promotion') return;
            commit({ from: selection.from, to: selection.to, promotion: piece }, 'promotion');
          }}
          onCancelPromotion={() => {
            if (selection.kind === 'promotion') pick(selection.from);
          }}
        />
        {strip(orientation)}
      </div>

      <div className="move-entry__controls" data-tone={status.tone}>
        {celebrate ? <span className="move-entry__confetti" aria-hidden="true" /> : null}
        {staged !== null ? (
          <div className="move-entry__staged" role="status">
            <span>
              You played <strong>{staged.san}</strong>
            </span>
            <button type="button" className="move-entry__undo" onClick={undoStaged}>
              Undo
            </button>
            <span
              className="move-entry__staged-timer"
              aria-hidden="true"
              ref={(node) => {
                if (node !== null) node.style.animationDuration = `${UNDO_WINDOW_MS}ms`;
              }}
            />
          </div>
        ) : (
          <p className="move-entry__status">{status.headline}</p>
        )}
        <p className="move-entry__substatus">
          <span data-testid="turn-status">
            {position.state === 'active' ? turnLabel(position.sideToMove) : 'Game complete'}
          </span>
          {position.state !== 'active' || position.moveDueAt === null || now === null ? null : (
            <>
              {' · '}
              <time dateTime={new Date(position.moveDueAt).toISOString()}>
                {dueLabel(new Date(position.moveDueAt), now)} ·{' '}
                {new Date(position.moveDueAt).toLocaleString(undefined, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </>
          )}
        </p>
        {position.viewerColor === null ? (
          <p className="move-entry__note">{"Only seated players can move. You're spectating."}</p>
        ) : selection.kind === 'promotion' ? (
          <p className="move-entry__note">Choose the piece your pawn becomes.</p>
        ) : null}
        {position.state === 'completed' ? (
          <GameEnd
            houseId={houseId}
            player={player}
            perMoveHours={live ? null : (afterGame?.perMoveHours ?? null)}
            incomingRematch={afterGame?.incomingRematch ?? null}
            share={{
              headline: endingHeadline({
                result: position.result,
                resultReason: position.resultReason,
                white: position.white.name,
                black: position.black.name,
              }),
              moves: position.moves,
            }}
          />
        ) : null}
        <button
          type="button"
          className="move-entry__sound"
          aria-pressed={sound.on}
          onClick={sound.toggle}
        >
          {sound.on ? 'Sound on' : 'Sound off'}
        </button>
      </div>

      <GameActions
        houseId={houseId}
        gameId={gameId}
        position={position}
        disabled={pending || offline || !canonicalFresh || staged !== null}
        onSettled={() => refreshCanonicalPosition()}
      />

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {message}
      </p>

      <details className="move-list" open>
        <summary>Move list ({position.moves.length})</summary>
        {position.moves.length === 0 ? (
          <p>No Moves yet.</p>
        ) : (
          <>
            <ol>
              {position.moves.map((move) => (
                <li
                  key={move.ply}
                  value={move.ply}
                  data-current={(reviewing && reviewPly === move.ply) || undefined}
                >
                  {positions === null ? (
                    <>
                      <span className="visually-hidden">Move {move.ply}: </span>
                      {move.san}
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Show the board after ${moveLabel(move)}`}
                      onClick={() =>
                        setReviewPly(move.ply === position.moves.length ? null : move.ply)
                      }
                    >
                      {move.san}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {positions === null ? null : (
              <div className="move-list__steps">
                <button
                  type="button"
                  aria-label="Previous move"
                  disabled={reviewPly === 0}
                  onClick={() =>
                    setReviewPly((current) => Math.max(0, (current ?? position.moves.length) - 1))
                  }
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next move"
                  disabled={!reviewing}
                  onClick={() =>
                    setReviewPly((current) =>
                      current === null || current + 1 >= position.moves.length ? null : current + 1,
                    )
                  }
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </details>
    </section>
  );
}
