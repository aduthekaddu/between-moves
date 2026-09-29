'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postHouseCommand } from '../../_components/house-command';

function failure(status: number): string {
  if (status === 0) return 'Could not connect. Try again.';
  if (status === 409) return 'Someone took this seat first.';
  if (status === 404) return 'This seat has closed.';
  if (status === 403) return 'This challenge is for someone else.';
  if (status === 401) return 'Your session expired. Sign in again to play.';
  return 'The seat could not be taken. Try again.';
}

/** [BM-023] Take an open seat or accept a challenge, then go straight to the board. */
export function AcceptSeatButton({
  houseId,
  gameId,
  mode,
  label,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly mode: 'correspondence' | 'live';
  readonly label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    if (pending) return;
    setPending(true);
    setError('');
    const game = `/h/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}`;
    const outcome = await postHouseCommand(
      `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/accept`,
    );
    if (outcome.ok) {
      router.push(mode === 'live' ? `${game}/live` : game);
      return;
    }
    setPending(false);
    setError(failure(outcome.status));
    if (outcome.status === 409 || outcome.status === 404) router.refresh();
  }

  return (
    <div className="seat-card__action">
      <button type="button" disabled={pending} onClick={() => void accept()}>
        {pending ? 'Taking the seat…' : label}
      </button>
      {error === '' ? null : <p role="alert">{error}</p>}
    </div>
  );
}
