'use client';

import { useState } from 'react';
import { welcomeCookieName } from './house-guide';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** A first visit's welcome. "Got it" hides it now and, through a cookie the page reads, for good. */
export function HouseWelcome({
  houseId,
  houseName,
  lines,
  action,
}: {
  readonly houseId: string;
  readonly houseName: string;
  readonly lines: readonly string[];
  readonly action: { readonly label: string; readonly href: string };
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    const path = `/h/${encodeURIComponent(houseId)}`;
    document.cookie = `${welcomeCookieName(houseId)}=1; Path=${path}; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
    setDismissed(true);
  }

  return (
    <section className="house-guide" aria-labelledby="house-welcome-title">
      <h2 id="house-welcome-title">Welcome to {houseName}</h2>
      <ul className="house-guide__points">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="house-guide__actions">
        <a className="house-guide__primary" href={action.href}>
          {action.label}
        </a>
        <button type="button" onClick={dismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}
