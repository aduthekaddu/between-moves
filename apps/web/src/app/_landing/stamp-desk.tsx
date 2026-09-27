'use client';

import { useState } from 'react';

const STAMPS = [
  { value: 'well_played', label: 'Well played', glyph: '♟' },
  { value: 'brilliant', label: 'Brilliant', glyph: '✦' },
  { value: 'dramatic', label: 'Dramatic', glyph: '!' },
  { value: 'funny', label: 'Funny', glyph: '☺' },
] as const;

type StampValue = (typeof STAMPS)[number]['value'];

/** The four House Reactions, as rubber stamps you can press onto a finished Game. */
export function StampDesk() {
  const [stamped, setStamped] = useState<{ value: StampValue; tilt: number; key: number } | null>(
    null,
  );
  const current = STAMPS.find((stamp) => stamp.value === stamped?.value);

  return (
    <div className="lp-desk">
      <article className="lp-gamecard" aria-live="polite">
        <p className="lp-gamecard__meta lp-mono">Night 3 · Board 2 · 1–0</p>
        <h3 className="lp-gamecard__title">Rohan v Lakshmi</h3>
        <p className="lp-gamecard__line lp-mono">15. Bxh7+ Kxh7 16. Ng5+ Kg8 17. Qh5</p>
        <p className="lp-gamecard__note">
          “I saw Bxh7 on the bus home and couldn’t unsee it.” <span>— Rohan</span>
        </p>
        {current === undefined || stamped === null ? (
          <p className="lp-gamecard__hint">
            Press a stamp. One Reaction each; change your mind any time.
          </p>
        ) : (
          <span
            key={stamped.key}
            className="lp-gamecard__stamp"
            data-kind={current.value}
            style={{ rotate: `${stamped.tilt}deg` }}
          >
            <span aria-hidden="true">{current.glyph}</span> {current.label}
          </span>
        )}
      </article>
      <div className="lp-desk__stamps" role="group" aria-label="Choose one Reaction">
        {STAMPS.map((stamp) => (
          <button
            key={stamp.value}
            type="button"
            className="lp-rubber"
            data-kind={stamp.value}
            aria-pressed={stamped?.value === stamp.value}
            onClick={() =>
              setStamped((previous) => ({
                value: stamp.value,
                tilt: Math.round((Math.random() - 0.5) * 14),
                key: (previous?.key ?? 0) + 1,
              }))
            }
          >
            <span className="lp-rubber__handle" aria-hidden="true" />
            <span className="lp-rubber__face">
              <span aria-hidden="true">{stamp.glyph}</span>
              {stamp.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
