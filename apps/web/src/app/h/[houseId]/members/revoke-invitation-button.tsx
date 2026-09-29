'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postHouseCommand } from '../../../_components/house-command';

/** [BM-014] Revoke one pending Invitation after a second click. */
export function RevokeInvitationButton({
  houseId,
  invitationId,
  label,
}: {
  readonly houseId: string;
  readonly invitationId: string;
  readonly label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function revoke() {
    setPending(true);
    setError('');
    const outcome = await postHouseCommand(
      `/api/houses/${encodeURIComponent(houseId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
    );
    setPending(false);
    if (!outcome.ok) {
      setError(
        outcome.status === 0
          ? 'Could not connect. Try again.'
          : 'The invitation could not be revoked. Refresh and try again.',
      );
      return;
    }
    router.refresh();
  }

  return (
    <div className="invitation-slip__actions">
      {confirming ? (
        <>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button
            type="button"
            className="member-actions__danger"
            disabled={pending}
            onClick={() => void revoke()}
          >
            {pending ? 'Revoking…' : 'Revoke link'}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Revoke <span className="visually-hidden">{label}</span>
        </button>
      )}
      {error === '' ? null : <p role="alert">{error}</p>}
    </div>
  );
}
