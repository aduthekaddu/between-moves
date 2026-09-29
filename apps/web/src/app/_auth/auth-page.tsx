/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import type { StaticImageData } from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '../_components/brand-mark';
import { MagicLinkForm, type AuthMode } from './magic-link-form';
import recoverPhoto from './media/recover.webp';
import signInPhoto from './media/sign-in.webp';
import signUpPhoto from './media/sign-up.webp';
import './auth.css';

interface AuthArt {
  readonly image: StaticImageData;
  readonly alt: string;
  readonly caption: string;
}

export const AUTH_ART = {
  'sign-in': {
    image: signInPhoto,
    alt: 'A papercraft room at evening: a paper chair pulled out at a low table with a chess game, a glass of chai and a phone, under a marigold lamp.',
    caption: 'Your chair is where you left it.',
  },
  'sign-up': {
    image: signUpPhoto,
    alt: 'A papercraft apartment door standing ajar, lamp light spilling onto the doormat, a folded-paper knight on the threshold.',
    caption: 'The door is open.',
  },
  recover: {
    image: recoverPhoto,
    alt: 'A folded-paper key on a marigold tag beside an open paper envelope and a softly glowing paper phone.',
    caption: 'Every lock has a spare key.',
  },
} as const satisfies Record<string, AuthArt>;

/** The shared door for every account page: the masthead, the words, one card, one photograph. */
export function AuthShell({
  eyebrow,
  title,
  lede,
  art,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly art: AuthArt;
  readonly children: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <header className="auth-masthead">
        <Link href="/" className="auth-brand" aria-label="Between Moves, home">
          <BrandMark />
          <span>Between Moves</span>
        </Link>
        <Link href="/" className="auth-masthead__back">
          Back to the House
        </Link>
      </header>
      <main className="auth-main">
        <div className="auth-intro">
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
        {children}
        <figure className="auth-photo">
          <img
            src={art.image.src}
            alt={art.alt}
            width={art.image.width}
            height={art.image.height}
          />
          <figcaption>{art.caption}</figcaption>
        </figure>
      </main>
    </div>
  );
}

export function AuthPage({ mode }: { readonly mode: AuthMode }) {
  const creating = mode === 'sign-up';
  return (
    <AuthShell
      eyebrow="Your seat at the table"
      title={creating ? 'Begin between moves.' : 'Welcome back.'}
      lede={
        creating
          ? 'Create an account to open a House or accept an invitation. Every House stays private to its Members.'
          : 'Sign in with your email to return to your Houses. We’ll send a one-time link.'
      }
      art={AUTH_ART[mode]}
    >
      <section className="auth-card" aria-label={creating ? 'Create account' : 'Sign in'}>
        <div className="auth-card__tabs" aria-label="Account access">
          <Link href="/sign-in" aria-current={creating ? undefined : 'page'}>
            Sign in
          </Link>
          <Link href="/sign-up" aria-current={creating ? 'page' : undefined}>
            Create account
          </Link>
        </div>
        <div className="auth-card__body">
          <p className="auth-card__eyebrow">{creating ? 'New account' : 'Your account'}</p>
          <h2>{creating ? 'Open the door.' : 'Pick up where you left off.'}</h2>
          <MagicLinkForm mode={mode} />
        </div>
        <div className="auth-card__foot">
          <p>Have a House invitation? Open its link after you sign in to join that House.</p>
          {creating ? null : (
            <p>
              Lost a phone, or signed in somewhere you shouldn’t be?{' '}
              <Link href="/recover">Recover your account</Link>
            </p>
          )}
        </div>
      </section>
    </AuthShell>
  );
}
