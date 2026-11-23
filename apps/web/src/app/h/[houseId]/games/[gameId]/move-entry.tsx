'use client';

import { isGameRealtimeTopic, type ChessSquare, type SideToMove } from '@between-moves/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Piece } from '../../../../_components/piece';
import {
  canMove as boardTakesMove,
  liveBoard,
  movableSquares,
  reviewing as isReviewing,
  shownPosition,
  turnLabel,
  UNDO_WINDOW_MS,
} from './board-machine';
import { parseFenPieces, type Fen } from './board-model';
import { useBoardSound } from './board-sound';
import { boardStatus } from './board-status';
import { LIVE_VIEWPORT, useBoardStore } from './board-store';
import { ChessBoard, type PromotionPiece } from './chess-board';
import { generateClientCommandId } from './client-command-id';
import { dueLabel, useMinuteClock } from './due-label';
import { GameActions } from './game-actions';
import { GameEnd, type RematchOffer } from './game-end';
import { endingHeadline } from './game-ending';
import { moveLabel, replayPositions } from './game-review';
import { legalMoves, turnState } from './legal-moves';
import { LiveClocks } from './live/live-clocks';
import { materialBalance } from './material';
import type { MoveEntryPosition } from './move-entry-wire';

export { UNDO_WINDOW_MS };

/** An open correspondence board re-reads the canonical Game this often while visible. */
const CORRESPONDENCE_REFRESH_MS = 60_000;

const noSquares: ReadonlySet<ChessSquare> = new Set();

/** One position as the board draws it, so its pieces and marks always agree. */
function boardView(fen: Fen, lastMove: string | null) {
  return { pieces: parseFenPieces(fen), ...turnState(fen), lastMove };
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
  const query = window.matchMedia(LIVE_VIEWPORT);
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
  const router = useRouter();
  const sound = useBoardSound();
  const now = useMinuteClock();
  const [state, store] = useBoardStore(houseId, gameId, initial, sound.play);
  const { dispatch } = store;
  const { snapshot: position, selection, live } = state;
  const liveViewport = useSyncExternalStore(
    subscribeToLiveViewport,
    () => window.matchMedia(LIVE_VIEWPORT).matches,
    () => true,
  );
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    () => !navigator.onLine,
    () => false,
  );
  const env = { online: !offline, wideEnough: liveViewport };
  const positions = useMemo(
    () => replayPositions(position.moves, position.currentFen),
    [position.currentFen, position.moves],
  );
  const newest = liveBoard(state);
  const legal = useMemo(() => legalMoves(newest.fen), [newest.fen]);
  const canMove = boardTakesMove(state, env);
  const pending = state.command.kind === 'sending';
  const staged = state.command.kind === 'staged' ? state.command : null;
  const movable = movableSquares(state, env, legal);
  const selectedFrom = selection.kind === 'none' ? null : selection.from;
  const targets =
    selection.kind === 'piece'
      ? new Set((legal.get(selection.from) ?? new Map()).keys())
      : noSquares;

  useEffect(() => {
    // A staged Move must not be lost when the reader leaves: send it as the page goes away.
    const sendNowIfHidden = () => {
      if (document.visibilityState === 'hidden') dispatch({ type: 'pageHidden' });
    };
    const sendNow = () => dispatch({ type: 'pageHidden' });
    document.addEventListener('visibilitychange', sendNowIfHidden);
    window.addEventListener('pagehide', sendNow);
    return () => {
      document.removeEventListener('visibilitychange', sendNowIfHidden);
      window.removeEventListener('pagehide', sendNow);
      sendNow();
    };
  }, [dispatch]);

  useEffect(() => {
    if (!live) return;
    const refocus = () => dispatch({ type: 'reconcileWanted', background: false });
    refocus(); // Replace the SSR snapshot after hydration, including any delivery delay.
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', refocus);
    const timer =
      position.state === 'active'
        ? window.setInterval(() => dispatch({ type: 'reconcileWanted', background: true }), 3000)
        : undefined;
    return () => {
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', refocus);
      window.clearInterval(timer);
    };
  }, [dispatch, live, position.state]);

  useEffect(() => {
    if (live || position.state !== 'active') return;
    // [BM-028] correspondence boards have no realtime channel: re-read when the reader comes
    // back to the tab, and now and then while it stays open, so offers and Moves appear
    const refocus = () => dispatch({ type: 'reconcileWanted', background: true });
    window.addEventListener('focus', refocus);
    document.addEventListener('visibilitychange', refocus);
    const timer = window.setInterval(refocus, CORRESPONDENCE_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', refocus);
      document.removeEventListener('visibilitychange', refocus);
      window.clearInterval(timer);
    };
  }, [dispatch, live, position.state]);

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
        source.onopen = () => dispatch({ type: 'reconcileWanted', background: true });
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
              dispatch({ type: 'reconcileWanted', background: true });
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
  }, [dispatch, gameId, houseId, live]);

  const endedHere = state.startedActive && position.state === 'completed';
  useEffect(() => {
    // The server read the page around the board, such as the head-to-head line, before the end.
    if (endedHere) router.refresh();
  }, [endedHere, router]);

  const orientation = position.viewerColor ?? 'white';
  const flipped: SideToMove = orientation === 'white' ? 'black' : 'white';
  const reviewing = isReviewing(state, positions);
  const reviewPly = state.reviewPly;
  const shown = shownPosition(state, positions);
  const board = useMemo(() => boardView(shown.fen, shown.lastMove), [shown.fen, shown.lastMove]);
  // A reviewed position is labelled by its own turn, even in a finished Game.
  const boardActive = reviewing || position.state === 'active';
  const balance = materialBalance(board.pieces);
  const status = boardStatus({
    position,
    fresh: state.sync.kind === 'fresh',
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
        data-to-move={(boardActive && board.sideToMove === color) || undefined}
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

      {offline && !state.offlineBannerDismissed ? (
        <div className="move-entry__banner" role="alert">
          <span>{"You're offline. We'll reconnect and refresh the board."}</span>
          <button type="button" onClick={() => dispatch({ type: 'offlineBannerDismissed' })}>
            Dismiss
          </button>
        </div>
      ) : null}
      {state.alert === '' ? null : (
        <div className="move-entry__banner" role="alert">
          <span>{state.alert}</span>
          {state.command.kind !== 'retryable' ? null : (
            <button
              type="button"
              onClick={() => dispatch({ type: 'retryPressed' })}
              disabled={pending || offline || (live && !liveViewport)}
            >
              Try again
            </button>
          )}
          {state.sync.kind !== 'failed' ? null : (
            <button type="button" onClick={() => dispatch({ type: 'refreshRequested' })}>
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
                : `After ${moveLabel(position.moves[reviewPly! - 1]!)}`}
            </span>
            <button type="button" onClick={() => dispatch({ type: 'reviewShown', ply: null })}>
              Back to the game
            </button>
          </div>
        ) : null}
        <ChessBoard
          pieces={board.pieces}
          orientation={orientation}
          sideToMove={board.sideToMove}
          active={boardActive}
          lastMove={board.lastMove}
          inCheck={board.inCheck}
          selected={reviewing ? null : selectedFrom}
          targets={reviewing ? noSquares : targets}
          movable={reviewing ? noSquares : movable}
          disabled={reviewing || !canMove || pending}
          pending={pending}
          slide={reviewing ? null : state.slide}
          promotion={
            !reviewing && selection.kind === 'promotion' && position.viewerColor !== null
              ? { color: position.viewerColor }
              : null
          }
          onSquare={(square) => {
            sound.wake();
            dispatch({ type: 'squareTapped', square, commandId: generateClientCommandId() });
          }}
          onDragStart={(square) => {
            sound.wake();
            dispatch({ type: 'dragStarted', square });
          }}
          onDrop={(from, to) =>
            dispatch({ type: 'pieceDropped', from, to, commandId: generateClientCommandId() })
          }
          onPromote={(piece: PromotionPiece) =>
            dispatch({ type: 'promotionChosen', piece, commandId: generateClientCommandId() })
          }
          onCancelPromotion={() => dispatch({ type: 'promotionCancelled' })}
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
            <button
              type="button"
              className="move-entry__undo"
              onClick={() => dispatch({ type: 'undoPressed' })}
            >
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
            {position.state === 'active' ? turnLabel(newest.sideToMove) : 'Game complete'}
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
        disabled={pending || offline || state.sync.kind !== 'fresh' || staged !== null}
        onSettled={store.refresh}
      />

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {state.message}
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
                      onClick={() => dispatch({ type: 'reviewShown', ply: move.ply })}
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
                  onClick={() => dispatch({ type: 'reviewStepped', step: 'previous' })}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next move"
                  disabled={!reviewing}
                  onClick={() => dispatch({ type: 'reviewStepped', step: 'next' })}
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
