'use client';

import type { ChessMoveProposal, ChessSquare, SideToMove } from '@between-moves/domain';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { applyOptimisticMove, parseFenPieces, type BoardPieces } from './board-model';
import { ChessBoard } from './chess-board';
import { generateClientCommandId } from './client-command-id';
import { LiveClocks } from './live/live-clocks';
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

function needsPromotion(pieces: BoardPieces, from: ChessSquare | null, to: ChessSquare | null) {
  if (from === null || to === null) return false;
  return pieces[from]?.kind === 'pawn' && (to[1] === '1' || to[1] === '8');
}

function turnLabel(side: SideToMove): string {
  return side === 'white' ? 'White to move' : 'Black to move';
}

function gameStatus(position: MoveEntryPosition, canonicalFresh: boolean): string {
  if (!canonicalFresh) return 'Refreshing the canonical Game';
  if (position.state === 'completed') {
    if (position.result === 'draw') return 'Game drawn';
    if (position.result === 'white_win') return `${position.white.name} won`;
    if (position.result === 'black_win') return `${position.black.name} won`;
    return 'Game ended';
  }
  if (position.viewerColor === null) return 'Watching this Game';
  return position.viewerColor === position.sideToMove ? 'Your move' : 'Waiting on the other Member';
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
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly initial: MoveEntryPosition;
}) {
  const [position, setPosition] = useState(initial);
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
  const [canonicalPieces, setCanonicalPieces] = useState(() => parseFenPieces(initial.currentFen));
  const [shownPieces, setShownPieces] = useState(canonicalPieces);
  const [from, setFrom] = useState<ChessSquare | null>(null);
  const [to, setTo] = useState<ChessSquare | null>(null);
  const [promotion, setPromotion] = useState<'q' | 'r' | 'b' | 'n'>('q');
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
  const confirmRef = useRef<HTMLButtonElement>(null);

  const canMove =
    (!live || liveViewport) &&
    canonicalFresh &&
    position.state === 'active' &&
    position.viewerColor === position.sideToMove &&
    !offline;
  const lastMove = position.moves.at(-1)?.uci.slice(0, 4) ?? null;
  const isPromotion = needsPromotion(canonicalPieces, from, to);
  const proposal = useMemo<ChessMoveProposal | null>(() => {
    if (from === null || to === null) return null;
    return { from, to, ...(isPromotion ? { promotion } : {}) };
  }, [from, isPromotion, promotion, to]);

  useEffect(() => {
    if (proposal !== null) confirmRef.current?.focus();
  }, [proposal]);

  function clearProposal() {
    setFrom(null);
    setTo(null);
    setPromotion('q');
  }

  function selectSquare(square: ChessSquare) {
    if (!canMove || pending) return;
    setAlert('');
    setRetry(null);
    if (from === null) {
      if (canonicalPieces[square]?.color !== position.viewerColor) {
        setMessage('Choose one of your pieces to begin a Move.');
        return;
      }
      setFrom(square);
      setMessage(`${square} selected. Choose a destination square.`);
      return;
    }
    if (square === from) {
      clearProposal();
      setMessage('Move selection cleared.');
      return;
    }
    if (canonicalPieces[square]?.color === position.viewerColor) {
      setFrom(square);
      setTo(null);
      setMessage(`${square} selected. Choose a destination square.`);
      return;
    }
    setTo(square);
    setMessage(`Move proposed from ${from} to ${square}. Review and submit.`);
  }

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
          const pieces = parseFenPieces(refreshed.currentFen);
          if (!background || refreshed.version !== positionVersion.current) {
            setFrom(null);
            setTo(null);
            setPromotion('q');
            setRetry(null);
          }
          positionVersion.current = refreshed.version;
          setPosition(refreshed);
          setCanonicalPieces(pieces);
          setShownPieces(pieces);
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

  const reconcileLive = useEffectEvent((background: boolean) => {
    if (document.visibilityState === 'hidden' || commandInFlight.current || !navigator.onLine)
      return;
    void refreshCanonicalPosition(background);
  });

  useEffect(() => {
    if (!live) return;
    const refocus = () => reconcileLive(false);
    refocus(); // Replace the SSR snapshot after hydration, including any delivery delay.
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', refocus);
    const timer =
      position.state === 'active' ? window.setInterval(() => reconcileLive(true), 3000) : undefined;
    return () => {
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', refocus);
      window.clearInterval(timer);
      refreshRequest.current?.controller.abort();
      refreshRequest.current = null;
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
        source.onopen = () => reconcileLive(true);
        source.onmessage = (event) => {
          try {
            const envelope: unknown = JSON.parse(event.data);
            if (
              envelope !== null &&
              typeof envelope === 'object' &&
              'channel' in envelope &&
              envelope.channel === channel &&
              'name' in envelope &&
              (envelope.name === 'game.move-accepted' || envelope.name === 'game.completed') &&
              'data' in envelope &&
              envelope.data !== null &&
              typeof envelope.data === 'object' &&
              'houseId' in envelope.data &&
              envelope.data.houseId === houseId &&
              'aggregateId' in envelope.data &&
              envelope.data.aggregateId === gameId
            ) {
              reconcileLive(true);
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

  async function sendMove(command: SubmitCommand) {
    if (commandInFlight.current || (live && !liveViewport)) return;
    commandInFlight.current = true;
    refreshRequest.current?.controller.abort();
    refreshRequest.current = null;
    setPending(true);
    setAlert('');
    setRetry(null);
    setShownPieces(applyOptimisticMove(canonicalPieces, command.proposal));
    setMessage(`Submitting ${command.proposal.from} to ${command.proposal.to}.`);
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/moves`,
        {
          method: 'POST',
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
        const pieces = parseFenPieces(accepted.fenAfter);
        setCanonicalPieces(pieces);
        setShownPieces(pieces);
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
        clearProposal();
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
        setShownPieces(canonicalPieces);
        clearProposal();
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
        const conflict = conflictPosition(body);
        if (conflict !== null) {
          const pieces = parseFenPieces(conflict.currentFen);
          setCanonicalPieces(pieces);
          setShownPieces(pieces);
          setPosition((current) => (live ? current : { ...current, ...conflict }));
        } else {
          setShownPieces(canonicalPieces);
        }
        clearProposal();
        setAlert(
          conflict === null
            ? "That Game changed. Here's the latest board."
            : "That position moved on. Here's the latest board.",
        );
        setCanonicalFresh(false);
        await refreshCanonicalPosition();
        return;
      }

      setShownPieces(canonicalPieces);
      clearProposal();
      setAlert(
        response.status === 422
          ? 'That Move is not legal from the current position. Choose another Move.'
          : "Something went wrong. Your last change wasn't saved — try again.",
      );
    } catch {
      setShownPieces(canonicalPieces);
      setRetry(command);
      setAlert("Something went wrong. Your last change wasn't saved — try again.");
    } finally {
      commandInFlight.current = false;
      setPending(false);
    }
  }

  function submitProposal() {
    if (proposal === null || pending || !canMove) return;
    void sendMove({
      proposal,
      expectedPly: position.currentPly,
      clientCommandId: generateClientCommandId(),
    });
  }

  const orientation = position.viewerColor ?? 'white';
  return (
    <section className="move-entry" aria-labelledby="board-heading">
      <div className="move-entry__heading">
        <h2 id="board-heading">Game board</h2>
        <p data-testid="turn-status">
          {position.state === 'active' ? turnLabel(position.sideToMove) : 'Game complete'}
        </p>
      </div>

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

      <ChessBoard
        pieces={shownPieces}
        orientation={orientation}
        sideToMove={position.sideToMove}
        active={position.state === 'active'}
        lastMove={lastMove}
        inCheck={position.inCheck}
        selectedFrom={from}
        selectedTo={to}
        disabled={!canMove || pending}
        pending={pending}
        onSquare={selectSquare}
      />

      <div className="move-entry__controls">
        {position.viewerColor === null ? (
          <p>{"Only seated players can move. You're spectating."}</p>
        ) : position.state !== 'active' ? (
          <p>This Game is no longer accepting Moves.</p>
        ) : live && !liveViewport ? (
          <p>Widen your window to make a Move.</p>
        ) : !canonicalFresh ? (
          <p>Refreshing the canonical Game before Move entry resumes.</p>
        ) : !canMove && !offline ? (
          <p>{"Waiting for the other Member's Move."}</p>
        ) : (
          <>
            <p>
              {proposal === null
                ? from === null
                  ? 'Choose a piece, then its destination.'
                  : `${from} selected. Choose a destination.`
                : `${proposal.from} to ${proposal.to}`}
            </p>
            {isPromotion ? (
              <label className="move-entry__promotion">
                Promote pawn to
                <select
                  value={promotion}
                  onChange={(event) => setPromotion(event.target.value as typeof promotion)}
                >
                  <option value="q">Queen</option>
                  <option value="r">Rook</option>
                  <option value="b">Bishop</option>
                  <option value="n">Knight</option>
                </select>
              </label>
            ) : null}
            <div className="move-entry__actions">
              <button
                ref={confirmRef}
                type="button"
                className="move-entry__submit"
                disabled={proposal === null || pending || offline}
                onClick={submitProposal}
              >
                {pending ? 'Submitting Move…' : 'Submit Move'}
              </button>
              <button
                type="button"
                disabled={(from === null && to === null) || pending}
                onClick={() => {
                  clearProposal();
                  setMessage('Move selection cleared.');
                }}
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>

      <div className="game-position-status" aria-live="polite">
        <strong>{gameStatus(position, canonicalFresh)}</strong>
        {position.moveDueAt === null || position.state !== 'active' ? null : (
          <span>
            Move due{' '}
            <time dateTime={new Date(position.moveDueAt).toISOString()}>
              {new Date(position.moveDueAt).toLocaleString('en', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC',
              })}{' '}
              UTC
            </time>
          </span>
        )}
      </div>

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {message}
      </p>

      <details className="move-list">
        <summary>Move list ({position.moves.length})</summary>
        {position.moves.length === 0 ? (
          <p>No Moves yet.</p>
        ) : (
          <ol>
            {position.moves.map((move) => (
              <li key={move.ply} value={move.ply}>
                <span className="visually-hidden">Move {move.ply}: </span>
                {move.san}
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
