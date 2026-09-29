'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function CreateHouseForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/houses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          timeZone: timeZone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your session expired. Sign in and try again.'
            : 'The House could not be created. Check its details and try again.',
        );
        return;
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        setError('The House was created, but we could not open it. Refresh your account page.');
        return;
      }
      if (
        result === null ||
        typeof result !== 'object' ||
        !('houseId' in result) ||
        typeof result.houseId !== 'string'
      ) {
        setError('The House was created, but we could not open it. Refresh your account page.');
        return;
      }
      router.push(`/h/${encodeURIComponent(result.houseId)}`);
      router.refresh();
    } catch {
      setError('Could not connect right now. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="account-create-form" onSubmit={(event) => void submit(event)}>
      <div className="account-create-form__field">
        <label htmlFor="new-house-name">House name</label>
        <input
          id="new-house-name"
          name="name"
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="The Thursday Table"
        />
      </div>
      <div className="account-create-form__field">
        <label htmlFor="new-house-time-zone">Time zone</label>
        <input
          id="new-house-time-zone"
          name="timeZone"
          value={timeZone}
          placeholder="Use my current time zone"
          onChange={(event) => setTimeZone(event.currentTarget.value)}
          aria-describedby="new-house-time-zone-note"
        />
        <p id="new-house-time-zone-note">
          Leave blank to use your current time zone. Used to schedule your House’s weekly Night.
        </p>
      </div>
      <div className="account-create-form__field">
        <label htmlFor="new-house-description">A line about your House (optional)</label>
        <textarea
          id="new-house-description"
          name="description"
          maxLength={500}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </div>
      {error ? (
        <p className="account-create-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="account-download" type="submit" disabled={pending}>
        {pending ? 'Opening House…' : 'Create House'}
      </button>
    </form>
  );
}
