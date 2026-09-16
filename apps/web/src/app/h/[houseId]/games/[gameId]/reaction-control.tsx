'use client';

import type { GameReactionValue } from '@between-moves/domain';
import { useState } from 'react';

const OPTIONS = [
  { value: 'well_played', label: 'Well played', symbol: '♟' },
  { value: 'brilliant', label: 'Brilliant', symbol: '✦' },
  { value: 'dramatic', label: 'Dramatic', symbol: '!' },
  { value: 'funny', label: 'Funny', symbol: '☺' },
] as const satisfies readonly {
  readonly value: GameReactionValue;
  readonly label: string;
  readonly symbol: string;
}[];

function labelFor(reaction: GameReactionValue): string {
  return OPTIONS.find((option) => option.value === reaction)?.label ?? reaction;
}

/** [BM-031] [UX-CMP-07] Accessible single-select current Reaction control. */
export function ReactionControl({
  houseId,
  gameId,
  initialReaction,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly initialReaction: GameReactionValue | null;
}) {
  const [reaction, setReaction] = useState(initialReaction);
  const [pending, setPending] = useState<GameReactionValue | null>(null);
  const [message, setMessage] = useState(
    initialReaction === null
      ? 'Choose one Reaction.'
      : `${labelFor(initialReaction)} is your current Reaction.`,
  );
  const [error, setError] = useState('');

  async function select(next: GameReactionValue): Promise<void> {
    if (pending !== null || next === reaction) return;
    setPending(next);
    setError('');
    setMessage(`Saving ${labelFor(next)}.`);
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/reactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction: next }),
        },
      );
      if (!response.ok) throw new Error('Reaction was not saved');
      const body = (await response.json()) as { readonly reaction?: unknown };
      if (body.reaction !== next) throw new Error('Reaction response was invalid');
      setReaction(next);
      setMessage(`${labelFor(next)} is your current Reaction.`);
    } catch {
      setMessage(
        reaction === null
          ? 'Choose one Reaction.'
          : `${labelFor(reaction)} is your current Reaction.`,
      );
      setError("Your Reaction wasn't saved. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="reaction-control" aria-labelledby="reaction-heading">
      <div>
        <p className="house-home__eyebrow">House moment</p>
        <h2 id="reaction-heading">React to this Game</h2>
      </div>
      <div className="reaction-control__options" role="group" aria-label="Choose one Reaction">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={reaction === option.value}
            disabled={pending !== null}
            onClick={() => void select(option.value)}
          >
            <span aria-hidden="true">{option.symbol}</span>
            <span>{option.label}</span>
            {reaction === option.value ? <span className="visually-hidden"> selected</span> : null}
          </button>
        ))}
      </div>
      <p className="reaction-control__status" aria-live="polite">
        {message}
      </p>
      {error === '' ? null : (
        <p className="reaction-control__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
