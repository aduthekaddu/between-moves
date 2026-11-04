'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  openSeason,
  type ProblemDetails,
  type SeasonOpening,
  type SeasonOpeningProgress,
} from './season/season-opening';

/** [BM-019] Open a four-week Season with the Season page's starting values, in one press. */
export function OpenSeasonButton({
  houseId,
  opening,
  progress: initialProgress,
  primary,
}: {
  readonly houseId: string;
  readonly opening: SeasonOpening;
  readonly progress: SeasonOpeningProgress;
  readonly primary: boolean;
}) {
  const router = useRouter();
  const [draftIdempotencyKey] = useState(() => crypto.randomUUID());
  const [progress, setProgress] = useState(initialProgress);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      await openSeason({
        houseId,
        opening,
        progress,
        draftIdempotencyKey,
        onProgress: setProgress,
      });
      router.refresh();
    } catch (failure) {
      setError((failure as ProblemDetails).detail ?? 'The Season did not open. Try again.');
      setPending(false);
    }
  }

  return (
    <div className="house-setup__action">
      <button
        type="button"
        className={primary ? 'house-guide__primary' : undefined}
        disabled={pending}
        onClick={() => void open()}
      >
        {pending ? 'Opening the Season…' : 'Open the Season'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
