'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ProblemDetails {
  readonly detail?: string;
}

/**
 * [BM-047] Owner/Steward close control with an inline, non-modal confirmation step.
 * A Season already in `closing` offers a direct retry without another confirmation.
 */
export function CloseSeasonPanel({
  houseId,
  seasonId,
  state,
}: {
  readonly houseId: string;
  readonly seasonId: string;
  readonly state: 'active' | 'closing';
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resuming = state === 'closing';

  /** Refresh after a successful close; display caught failures and re-enable retry controls. */
  async function close() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/seasons/${encodeURIComponent(seasonId)}/close`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as ProblemDetails;
        throw new Error(problem.detail ?? 'The Season could not be closed. Try again.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Season could not be closed.');
      setSubmitting(false);
    }
  }

  return (
    <section className="season-close" aria-labelledby="season-close-title">
      <p className="season-eyebrow">End of the Season</p>
      <h2 id="season-close-title">{resuming ? 'Finish closing' : 'Close the Season'}</h2>
      <p className="season-close__lede">
        {resuming
          ? 'The standings are already frozen. Finish closing to open the table for the next Season.'
          : 'Closing freezes the standings from the points ledger and opens the table for the next Season. It cannot be undone.'}
      </p>
      {resuming ? (
        <button
          type="button"
          className="season-close__confirm"
          disabled={submitting}
          onClick={() => void close()}
        >
          {submitting ? 'Closing…' : 'Finish closing'}
        </button>
      ) : confirming ? (
        <div className="season-close__actions" role="group" aria-label="Confirm Season close">
          <button type="button" disabled={submitting} onClick={() => setConfirming(false)}>
            Keep playing
          </button>
          <button
            type="button"
            className="season-close__confirm"
            disabled={submitting}
            onClick={() => void close()}
          >
            {submitting ? 'Closing…' : 'Close and finalize standings'}
          </button>
        </div>
      ) : (
        <button type="button" className="season-close__start" onClick={() => setConfirming(true)}>
          Close Season
        </button>
      )}
      {error === null ? null : (
        <p className="charter-form__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
