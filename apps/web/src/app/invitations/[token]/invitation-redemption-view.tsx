import type { FormEventHandler } from 'react';
import { BrandMark } from '../../_components/brand-mark';

export type InvitationRedemptionViewState =
  | { readonly kind: 'sign_in' }
  | { readonly kind: 'sending_link' }
  | { readonly kind: 'sign_in_error' }
  | { readonly kind: 'email_sent' }
  | { readonly kind: 'redeeming' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'house_full' }
  | { readonly kind: 'redeem_error' };

export interface InvitationRedemptionViewProps {
  readonly state: InvitationRedemptionViewState;
  readonly email: string;
  readonly onEmailChange: (email: string) => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly onRetry: () => void;
}

function InvitationMessage({ state }: { readonly state: InvitationRedemptionViewState }) {
  switch (state.kind) {
    case 'email_sent':
      return (
        <div className="invitation-card__message" role="status">
          <p className="invitation-card__eyebrow">Check your email</p>
          <h1 id="invitation-title">Your way back is in the post.</h1>
          <p>The sign-in link returns here so you can join the House.</p>
        </div>
      );
    case 'redeeming':
      return (
        <div className="invitation-card__message" role="status">
          <p className="invitation-card__eyebrow">Invitation found</p>
          <h1 id="invitation-title">Joining your House...</h1>
          <p>This should only take a moment.</p>
        </div>
      );
    case 'invalid':
      return (
        <div className="invitation-card__message" role="alert">
          <p className="invitation-card__eyebrow">Invitation unavailable</p>
          <h1 id="invitation-title">Invitation unavailable.</h1>
          <p>This invitation is no longer valid. Ask an owner or steward for a new link.</p>
        </div>
      );
    case 'house_full':
      return (
        <div className="invitation-card__message" role="alert">
          <p className="invitation-card__eyebrow">No open seats</p>
          <h1 id="invitation-title">No open seats right now.</h1>
          <p>This House is full. No more members can join right now.</p>
        </div>
      );
    case 'redeem_error':
      return (
        <div className="invitation-card__message" role="alert">
          <p className="invitation-card__eyebrow">Still at the door</p>
          <h1 id="invitation-title">We could not join the House.</h1>
          <p>The Invitation may still be usable. Try once more.</p>
        </div>
      );
    case 'sign_in':
    case 'sending_link':
    case 'sign_in_error':
      return null;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** [BM-016] [PR-PLAT-01] Focused, narrow-width Invitation and sign-in states. */
export function InvitationRedemptionView({
  state,
  email,
  onEmailChange,
  onSubmit,
  onRetry,
}: InvitationRedemptionViewProps) {
  const showsForm =
    state.kind === 'sign_in' || state.kind === 'sending_link' || state.kind === 'sign_in_error';

  return (
    <main className="invitation-shell">
      <div className="invitation-shell__scene" aria-hidden="true" />
      <article className="invitation-card" aria-labelledby="invitation-title">
        <header className="invitation-card__masthead">
          <BrandMark className="invitation-card__mark" />
          <span>Between Moves</span>
          <span className="invitation-card__seal" aria-hidden="true">
            Nº 1
          </span>
        </header>

        {showsForm ? (
          <div className="invitation-card__message">
            <p className="invitation-card__eyebrow">A House Invitation</p>
            <h1 id="invitation-title">Come into the House.</h1>
            <p>Sign in by email. Your Invitation will be waiting when you return.</p>
            <form className="invitation-form" onSubmit={onSubmit}>
              <label htmlFor="invitation-email">Email address</label>
              <input
                id="invitation-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => onEmailChange(event.currentTarget.value)}
                aria-describedby={state.kind === 'sign_in_error' ? 'invitation-error' : undefined}
              />
              {state.kind === 'sign_in_error' ? (
                <p id="invitation-error" className="invitation-form__error" role="alert">
                  We could not send that link. Check the address and try again.
                </p>
              ) : null}
              <button type="submit" disabled={state.kind === 'sending_link'}>
                {state.kind === 'sending_link' ? 'Sending link...' : 'Send me a sign-in link'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <InvitationMessage state={state} />
            {state.kind === 'redeem_error' ? (
              <button className="invitation-card__retry" type="button" onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </>
        )}

        <footer className="invitation-card__footer">A private chess House for your group.</footer>
      </article>
    </main>
  );
}
