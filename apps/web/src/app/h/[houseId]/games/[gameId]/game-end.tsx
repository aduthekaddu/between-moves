'use client';

import type { SideToMove } from '@between-moves/domain';
import { useRef, useState } from 'react';
import {
  newIdempotencyKey,
  postHouseCommand,
  problemDetail,
} from '../../../../_components/house-command';
import { AcceptSeatButton } from '../../accept-seat-button';

export interface RematchOffer {
  /** The waiting Game the opponent opened for the viewer. */
  readonly gameId: string;
}

/** What a finished Game can lead to: the next Game against the same person. */
export function GameEnd({
  houseId,
  viewerColor,
  opponent,
  perMoveHours,
  incomingRematch,
}: {
  readonly houseId: string;
  readonly viewerColor: SideToMove | null;
  readonly opponent: { readonly name: string; readonly membershipId?: string | undefined };
  /** The active Season's pace, or null when no Season is open for a new Game. */
  readonly perMoveHours: number | null;
  readonly incomingRematch: RematchOffer | null;
}) {
  const idempotencyKey = useRef(newIdempotencyKey());
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const house = `/h/${encodeURIComponent(houseId)}`;

  async function sendRematch() {
    if (state !== 'idle' || viewerColor === null || perMoveHours === null) return;
    setState('sending');
    setError('');
    const outcome = await postHouseCommand(`/api/houses/${encodeURIComponent(houseId)}/games`, {
      idempotencyKey: idempotencyKey.current,
      body: {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours },
        // The seat's colour is the one the taker plays: the opponent gets the viewer's old colour.
        offeredColor: viewerColor,
        intendedMembershipId: opponent.membershipId,
      },
    });
    if (outcome.ok) {
      setState('sent');
      return;
    }
    setState('idle');
    if (outcome.status !== 0) idempotencyKey.current = newIdempotencyKey();
    setError(problemDetail(outcome.body) ?? 'The rematch could not be sent. Try again.');
  }

  const canChallenge =
    viewerColor !== null && perMoveHours !== null && opponent.membershipId !== undefined;
  return (
    <div className="game-end">
      {viewerColor !== null && incomingRematch !== null ? (
        <AcceptSeatButton
          houseId={houseId}
          gameId={incomingRematch.gameId}
          mode="correspondence"
          label={`Accept ${opponent.name}’s rematch`}
        />
      ) : canChallenge ? (
        state === 'sent' ? (
          <p className="game-end__sent" role="status">
            Rematch sent. {opponent.name} will see it on the House page.
          </p>
        ) : (
          <button
            type="button"
            className="game-end__rematch"
            disabled={state === 'sending'}
            onClick={() => void sendRematch()}
          >
            {state === 'sending' ? 'Sending…' : `Rematch ${opponent.name}`}
          </button>
        )
      ) : null}
      {error === '' ? null : <p role="alert">{error}</p>}
      <a className="game-end__home" href={house}>
        Back to the House
      </a>
    </div>
  );
}
