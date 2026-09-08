'use client';

import type { ChessMoveProposal, ChessSquare, SideToMove } from '@between-moves/domain';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { applyOptimisticMove, parseFenPieces, type BoardPieces } from './board-model';
import { ChessBoard } from './chess-board';
import { generateClientCommandId } from './client-command-id';
import {
  acceptedMove,
  conflictPosition,
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

/** [BM-027] [PR-JRN-05] Client proposal flow reconciled only from submitMove responses. */
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

  async function refreshCanonicalPosition(): Promise<MoveEntryPosition | null> {
    setCanonicalFresh(false);
    setRefreshNeeded(false);
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`,
        { cache: 'no-store' },
      );
      const body: unknown = await response.json();
      const refreshed = response.ok ? moveEntryPosition(body) : null;
      if (refreshed === null) throw new Error('Canonical Game response is invalid');
      const pieces = parseFenPieces(refreshed.currentFen);
      setPosition(refreshed);
      setCanonicalPieces(pieces);
      setShownPieces(pieces);
      setCanonicalFresh(true);
      setAlert((current) =>
        current === 'The Move was saved, but the full Game could not be refreshed.' ? '' : current,
      );
      return refreshed;
    } catch {
      setRefreshNeeded(true);
      return null;
    }
  }

  async function sendMove(command: SubmitCommand) {
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
        const pieces = parseFenPieces(accepted.fenAfter);
        setCanonicalPieces(pieces);
        setShownPieces(pieces);
        setPosition((current) => ({
          ...current,
          currentFen: accepted.fenAfter,
          currentPly: accepted.ply,
          sideToMove: accepted.sideToMove,
          version: accepted.version,
          moves: [...current.moves, { ply: accepted.ply, uci: accepted.uci, san: accepted.san }],
        }));
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

      if (response.status === 409) {
        const conflict = conflictPosition(body);
        if (conflict !== null) {
          const pieces = parseFenPieces(conflict.currentFen);
          setCanonicalPieces(pieces);
          setShownPieces(pieces);
          setPosition((current) => ({ ...current, ...conflict }));
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
              disabled={pending || offline}
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
