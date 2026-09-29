'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out failed');
      router.replace('/sign-in');
      router.refresh();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="account-sign-out">
      <button type="button" onClick={() => void signOut()} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? <p role="alert">Could not sign out. Please try again.</p> : null}
    </div>
  );
}
