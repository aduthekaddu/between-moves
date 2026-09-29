'use client';

/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import Link from 'next/link';
import mending from './_art/mending.webp';
import { BrandMark } from './_components/brand-mark';

/** Unexpected render failures below the root layout. `retry` re-fetches the segment. */
export default function RouteError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  return (
    <main className="house-unavailable house-unavailable--night lost-page">
      <figure className="lost-page__photo">
        <img
          src={mending.src}
          alt="A folded-paper hand setting a paper king upright on a chess board where a few pieces have been knocked over."
          width={mending.width}
          height={mending.height}
        />
      </figure>
      <section className="house-unavailable__sheet" aria-labelledby="route-error-title">
        <BrandMark className="house-unavailable__mark" />
        <p className="house-home__eyebrow">Something went wrong</p>
        <h1 id="route-error-title">A piece slipped off the table.</h1>
        <p>This page could not be shown just now. Try again, or head back to the front door.</p>
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
  );
}
