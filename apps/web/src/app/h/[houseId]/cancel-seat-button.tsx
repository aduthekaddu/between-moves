'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postHouseCommand } from '../../_components/house-command';

function failure(status: number): string {
  if (status === 0) return 'Could not connect. Try again.';
  if (status === 409) return 'Someone took this seat first.';
  if (status === 404) return 'This seat has already closed.';
  if (status === 401) return 'Your session expired. Sign in again.';
  return 'The seat could not be cancelled. Try again.';
}

/** [BM-022] [BM-023] Take down your own open seat, or turn down a challenge made to you. */
export function CancelSeatButton({
  houseId,
  gameId,
  label,
  pendingLabel,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly label: string;
  readonly pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function cancel() {
    if (pending) return;
    setPending(true);
    setError('');
    const outcome = await postHouseCommand(
      `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/cancel`,
    );
    if (outcome.ok) {
      router.refresh();
      return;
    }
    setPending(false);
    setError(failure(outcome.status));
    if (outcome.status === 409 || outcome.status === 404) router.refresh();
  }

  return (
    <div className="seat-card__action seat-card__action--quiet">
      <button type="button" disabled={pending} onClick={() => void cancel()}>
        {pending ? pendingLabel : label}
      </button>
      {error === '' ? null : <p role="alert">{error}</p>}
    </div>
  );
}
