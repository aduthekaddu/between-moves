'use client';

import { useState, type FormEvent } from 'react';

/**
 * [BM-010] Ask for a recovery link. The server answers 204 whether or not the address has an
 * account, so this form says the same thing either way.
 */
export function RecoveryForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limited'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    try {
      const response = await fetch('/api/auth/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setState(response.status === 204 ? 'sent' : response.status === 429 ? 'limited' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="auth-result" role="status">
        <span className="auth-result__mark" aria-hidden="true">
          ✉
        </span>
        <h2>Check your email</h2>
        <p>
          If an account uses <strong>{email.trim()}</strong>, a recovery link is on its way. Open it
          on the device you want to keep: every other device is signed out.
        </p>
        <button className="auth-text-button" type="button" onClick={() => setState('idle')}>
          Use another email address
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <div className="auth-form__field">
        <label htmlFor="recovery-email">Email address</label>
        <input
          id="recovery-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          aria-describedby="recovery-email-note"
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <p id="recovery-email-note">Use the address you sign in with.</p>
      </div>
      {state === 'error' || state === 'limited' ? (
        <p className="auth-form__error" role="alert">
          {state === 'limited'
            ? 'Too many requests. Please wait a little before trying again.'
            : 'We could not request a link right now. Please try again.'}
        </p>
      ) : null}
      <button className="auth-form__submit" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending link…' : 'Send recovery link'}
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
