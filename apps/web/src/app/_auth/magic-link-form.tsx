'use client';

import { useState, type FormEvent } from 'react';

export type AuthMode = 'sign-in' | 'sign-up';

export function MagicLinkForm({ mode }: { readonly mode: AuthMode }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limited'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          ...(mode === 'sign-up' ? { name: name.trim() } : {}),
        }),
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
          If a link can be sent to <strong>{email.trim()}</strong>, it will arrive shortly. Open it
          on this device to finish {mode === 'sign-up' ? 'creating your account' : 'signing in'}.
        </p>
        <button className="auth-text-button" type="button" onClick={() => setState('idle')}>
          Use another email address
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      {mode === 'sign-up' ? (
        <div className="auth-form__field">
          <label htmlFor="auth-name">Your name</label>
          <input
            id="auth-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
      ) : null}
      <div className="auth-form__field">
        <label htmlFor="auth-email">Email address</label>
        <input
          id="auth-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          aria-describedby="auth-email-note"
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <p id="auth-email-note">We’ll send you a private link. No password needed.</p>
      </div>
      {state === 'error' || state === 'limited' ? (
        <p className="auth-form__error" role="alert">
          {state === 'limited'
            ? 'Too many requests. Please wait a little before trying again.'
            : 'We could not request a link right now. Please try again.'}
        </p>
      ) : null}
      <button className="auth-form__submit" type="submit" disabled={state === 'sending'}>
        {state === 'sending'
          ? 'Sending link…'
          : mode === 'sign-up'
            ? 'Create account with email'
            : 'Send sign-in link'}
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
