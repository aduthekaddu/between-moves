/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import Link from 'next/link';
import lostKnight from './_art/lost-knight.webp';
import { BrandMark } from './_components/brand-mark';

/** Any URL the app does not know. House-scoped misses keep their own neutral denial page. */
export default function NotFound() {
  return (
    <main className="house-unavailable house-unavailable--night lost-page">
      <figure className="lost-page__photo">
        <img
          src={lostKnight.src}
          alt="A folded-paper knight alone at the edge of an empty paper chess board, a blank signpost beside it under a lamp."
          width={lostKnight.width}
          height={lostKnight.height}
        />
      </figure>
      <section className="house-unavailable__sheet" aria-labelledby="not-found-title">
        <BrandMark className="house-unavailable__mark" />
        <p className="house-home__eyebrow">404 · Off the board</p>
        <h1 id="not-found-title">This square is empty.</h1>
        <p>There is no page here. The link may be mistyped, or what it pointed to has moved on.</p>
        <div className="lost-page__links">
          <Link className="house-unavailable__home" href="/">
            Back to the front door
          </Link>
          <Link className="house-unavailable__home" href="/account">
            Your Houses
          </Link>
        </div>
      </section>
    </main>
  );
}
