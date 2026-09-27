'use client';

import { ACCOUNT_DELETION_CONFIRMATION } from '@between-moves/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ProblemDetails {
  readonly detail?: string;
}

const names = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * [BM-050] Irreversible account deletion behind an inline confirmation: the person reads what
 * goes and what stays, then types the confirmation phrase. An Owner transfers first.
 */
export function DeleteAccountPanel({ ownedHouses }: { readonly ownedHouses: readonly string[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = phrase === ACCOUNT_DELETION_CONFIRMATION;

  /** Leave for the front door once deleted; show a caught failure and allow a retry. */
  async function deleteAccount() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: phrase }),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as ProblemDetails;
        throw new Error(problem.detail ?? 'Your account could not be deleted. Try again.');
      }
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your account could not be deleted.');
      setSubmitting(false);
    }
  }

  return (
    <section className="account-delete" aria-labelledby="account-delete-title">
      <h2 id="account-delete-title">Delete your account</h2>
      <p className="account-section__copy">
        Deleting removes your name, email address and sign-in, signs you out everywhere, and ends
        your membership of every House. It cannot be undone.
      </p>
      <p className="account-section__copy">
        Your Houses keep their shared history: Games, Moves, scores and Closing Books stay, and your
        messages and notes stay in place. Everywhere they appear, they read “Former member”.
      </p>
      {ownedHouses.length > 0 ? (
        <p className="account-delete__blocked">
          You own {names.format(ownedHouses)}. Transfer ownership before you delete your account.
        </p>
      ) : confirming ? (
        <div className="account-delete__confirm">
          <label htmlFor="account-delete-phrase">
            Type “{ACCOUNT_DELETION_CONFIRMATION}” to confirm
          </label>
          <input
            id="account-delete-phrase"
            autoComplete="off"
            spellCheck={false}
            value={phrase}
            disabled={submitting}
            onChange={(event) => setPhrase(event.target.value)}
          />
          <div className="account-delete__actions" role="group" aria-label="Confirm deletion">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setConfirming(false);
                setPhrase('');
                setError(null);
              }}
            >
              Keep my account
            </button>
            <button
              type="button"
              className="account-delete__final"
              disabled={!confirmed || submitting}
              onClick={() => void deleteAccount()}
            >
              {submitting ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="account-delete__start" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      )}
      {error === null ? null : (
        <p className="account-delete__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
