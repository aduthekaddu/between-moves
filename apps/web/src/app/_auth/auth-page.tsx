import Link from 'next/link';
import { BrandMark } from '../_components/brand-mark';
import { MagicLinkForm, type AuthMode } from './magic-link-form';
import './auth.css';

export function AuthPage({ mode }: { readonly mode: AuthMode }) {
  const creating = mode === 'sign-up';
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
          <p className="auth-eyebrow">Your seat at the table</p>
          <h1>{creating ? 'Begin between moves.' : 'Welcome back.'}</h1>
          <p>
            {creating
              ? 'Create an account to open a House or accept an invitation. Every House stays private to its Members.'
              : 'Sign in with your email to return to your Houses. We’ll send a one-time link.'}
          </p>
        </div>
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
          <p className="auth-card__foot">
            Have a House invitation? Open its link after you sign in to join that House.
          </p>
        </section>
      </main>
    </div>
  );
}
