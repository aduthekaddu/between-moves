import Link from 'next/link';
import { BrandMark } from '../_components/brand-mark';
import { MagicLinkForm, type AuthMode } from './magic-link-form';
import './auth.css';

/**
 * The stage door. On the left, the lit screen: the lamplighter walks you back to the House
 * (sign in) or the whole company waits to be joined (create an account). On the right, an
 * admission ticket; when the link is sent, its stub tears off.
 */
export function AuthPage({ mode }: { readonly mode: AuthMode }) {
  const creating = mode === 'sign-up';
  return (
    <div className="auth-shell" data-mode={mode}>
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
        <div className="auth-stage">
          <span className="auth-stage__lamp" aria-hidden="true" />
          <span className="auth-stage__cast" aria-hidden="true" />
          <div className="auth-intro">
            <p className="auth-eyebrow">{creating ? 'Join the company' : 'The stage door'}</p>
            <h1>{creating ? 'Begin between moves.' : 'Welcome back.'}</h1>
            <p>
              {creating
                ? 'Create an account to open a House or accept an invitation. Every House stays private to its Members.'
                : 'Sign in with your email to return to your Houses. We’ll send a one-time link.'}
            </p>
          </div>
        </div>
        <div className="auth-desk">
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
            <span className="auth-card__stub" aria-hidden="true">
              <span>Admit one</span>
              <span>No password</span>
            </span>
          </section>
        </div>
      </main>
    </div>
  );
}
