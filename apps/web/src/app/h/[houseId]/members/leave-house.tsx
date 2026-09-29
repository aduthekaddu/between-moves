'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postHouseCommand, problemDetail } from '../../../_components/house-command';

/** [BM-015] [DR-MEM-05] Leave a House after a confirmation. An Owner must hand it over first. */
export function LeaveHouse({
  houseId,
  houseName,
  isOwner,
}: {
  readonly houseId: string;
  readonly houseName: string;
  readonly isOwner: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function leave() {
    setPending(true);
    setError('');
    const outcome = await postHouseCommand(`/api/houses/${encodeURIComponent(houseId)}/leave`);
    if (!outcome.ok) {
      setPending(false);
      setError(
        outcome.status === 0
          ? 'Could not connect. Try again.'
          : (problemDetail(outcome.body) ?? 'You could not leave the House. Try again.'),
      );
      return;
    }
    router.replace('/account');
    router.refresh();
  }

  return (
    <section className="members-leave" aria-labelledby="members-leave-title">
      <h2 id="members-leave-title">Leave {houseName}</h2>
      {isOwner ? (
        <p>
          You own this House. To leave it, first hand it to another Member from their Manage menu.
        </p>
      ) : confirming ? (
        <div className="members-leave__confirm" role="group" aria-label="Confirm leaving">
          <p>
            You will lose access to its Games, chat and Puzzles. Your Moves and results stay in the
            House’s history. Only a new invitation lets you back in.
          </p>
          <div className="member-actions__buttons">
            <button type="button" disabled={pending} onClick={() => setConfirming(false)}>
              Stay
            </button>
            <button
              type="button"
              className="member-actions__danger"
              disabled={pending}
              onClick={() => void leave()}
            >
              {pending ? 'Leaving…' : 'Leave the House'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>Stepping away for good? You can leave at any time.</p>
          <button type="button" onClick={() => setConfirming(true)}>
            Leave this House
          </button>
        </>
      )}
      {error === '' ? null : <p role="alert">{error}</p>}
    </section>
  );
}
