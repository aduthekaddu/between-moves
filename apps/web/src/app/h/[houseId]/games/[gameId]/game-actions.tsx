'use client';

import { useRef, useState } from 'react';
import { postHouseCommand, problemDetail } from '../../../../_components/house-command';
import { generateClientCommandId } from './client-command-id';
import { viewerMembershipId, type MoveEntryPosition } from './move-entry-wire';

type Command = 'resign' | 'offer' | 'accept';

function failure(status: number, body: unknown): string {
  if (status === 0) return 'Could not connect. Check your connection and try again.';
  if (status === 401) return 'Your session expired. Sign in again to continue.';
  if (status === 409)
    return 'The Game changed before that reached the table. Here is the latest board.';
  return problemDetail(body) ?? 'That did not go through. Try again.';
}

/**
 * [BM-028] [DR-DRAW-02] Resign, offer a draw, or accept the opponent's offer. A draw can be
 * offered only while the opponent is to move, and the next Move withdraws it.
 */
export function GameActions({
  houseId,
  gameId,
  position,
  disabled,
  onSettled,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly position: MoveEntryPosition;
  readonly disabled: boolean;
  readonly onSettled: () => Promise<unknown>;
}) {
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const [error, setError] = useState('');
  // a retried command keeps its id so the server can replay rather than act twice
  const commandIds = useRef(new Map<Command, string>());

  if (position.viewerColor === null || position.state !== 'active') return null;
  const opponent = position[position.viewerColor === 'white' ? 'black' : 'white'].name;
  const me = viewerMembershipId(position);
  const offer = position.pendingDrawOffer ?? null;
  const offeredByMe = offer !== null && me !== null && offer.offeringMembershipId === me;
  const offeredToMe = offer !== null && !offeredByMe;
  const myTurn = position.sideToMove === position.viewerColor;
  const busy = disabled || pending !== null;

  async function send(command: Command) {
    if (pending !== null) return;
    const clientCommandId = commandIds.current.get(command) ?? generateClientCommandId();
    commandIds.current.set(command, clientCommandId);
    setPending(command);
    setError('');
    const base = `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`;
    const outcome = await postHouseCommand(
      command === 'resign' ? `${base}/resign` : `${base}/draw`,
      {
        body: command === 'resign' ? { clientCommandId } : { action: command, clientCommandId },
      },
    );
    if (outcome.status !== 0) commandIds.current.delete(command);
    if (!outcome.ok) setError(failure(outcome.status, outcome.body));
    if (outcome.ok || outcome.status === 409) {
      setConfirmingResign(false);
      await onSettled();
    }
    setPending(null);
  }

  return (
    <section className="game-actions" aria-labelledby="game-actions-title">
      <h2 id="game-actions-title" className="visually-hidden">
        Draw and resignation
      </h2>
      {offeredToMe ? (
        <div className="game-actions__offer" role="status">
          <p>
            <strong>{opponent} offers a draw.</strong> Accept it, or make your Move to play on.
          </p>
          <button
            type="button"
            className="game-actions__accept"
            disabled={busy}
            onClick={() => void send('accept')}
          >
            {pending === 'accept' ? 'Agreeing…' : 'Accept the draw'}
          </button>
        </div>
      ) : offeredByMe ? (
        <p className="game-actions__note" role="status">
          You offered a draw. It stands until {opponent} moves.
        </p>
      ) : null}

      {confirmingResign ? (
        <div className="game-actions__confirm" role="group" aria-label="Confirm resignation">
          <p>Resign this Game? {opponent} wins, and the result counts toward the Season.</p>
          <div className="game-actions__buttons">
            <button type="button" disabled={busy} onClick={() => setConfirmingResign(false)}>
              Keep playing
            </button>
            <button
              type="button"
              className="game-actions__resign"
              disabled={busy}
              onClick={() => void send('resign')}
            >
              {pending === 'resign' ? 'Resigning…' : 'Resign'}
            </button>
          </div>
        </div>
      ) : (
        <div className="game-actions__buttons">
          {offer === null ? (
            <button
              type="button"
              disabled={busy || myTurn}
              aria-describedby={myTurn ? 'game-actions-draw-hint' : undefined}
              onClick={() => void send('offer')}
            >
              {pending === 'offer' ? 'Offering…' : 'Offer a draw'}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => setConfirmingResign(true)}>
            Resign
          </button>
        </div>
      )}
      {offer === null && myTurn && !confirmingResign ? (
        <p id="game-actions-draw-hint" className="game-actions__hint">
          You can offer a draw after your Move, while {opponent} thinks.
        </p>
      ) : null}
      {error === '' ? null : (
        <p className="game-actions__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
