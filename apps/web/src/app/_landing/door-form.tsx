'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { invitationPathFromLink } from './invitation-link';

/** Invitation links travel by message; this lets someone open one they received elsewhere. */
export function DoorForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = invitationPathFromLink(value);
    if (path === null) {
      setError('That doesn’t look like a House invitation link. It should contain /invitations/.');
      return;
    }
    setError('');
    router.push(path);
  }

  return (
    <form className="lp-door__form" onSubmit={open} noValidate>
      <label htmlFor="door-link">Got the link on another device? Paste it here.</label>
      <div className="lp-door__field">
        <input
          id="door-link"
          name="invitation"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://…/invitations/…"
          value={value}
          aria-invalid={error === '' ? undefined : true}
          aria-describedby={error === '' ? undefined : 'door-error'}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setError('');
          }}
        />
        <button type="submit" className="lp-button">
          Open <span className="lp-button__arrow">→</span>
        </button>
      </div>
      {error === '' ? null : (
        <p id="door-error" className="lp-door__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
