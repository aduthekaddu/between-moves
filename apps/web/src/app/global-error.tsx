'use client';

import Link from 'next/link';
import './globals.css';

/** Failures in the root layout itself. It renders its own document, without the app fonts. */
export default function GlobalError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="house-unavailable house-unavailable--night">
          <section className="house-unavailable__sheet" aria-labelledby="global-error-title">
            <p className="house-home__eyebrow">Between Moves</p>
            <h1 id="global-error-title">The lamp went out.</h1>
            <p>Between Moves could not open just now. Try again in a moment.</p>
            {error.digest === undefined ? null : (
              <p className="lost-page__reference">Reference {error.digest}</p>
            )}
            <div className="lost-page__links">
              <button type="button" onClick={() => retry()}>
                Try again
              </button>
              <Link className="house-unavailable__home" href="/">
                Back to the front door
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
