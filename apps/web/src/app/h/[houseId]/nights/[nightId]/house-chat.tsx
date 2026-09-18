'use client';

import type { HouseChatSnapshotResponse } from '@between-moves/contracts';
import { useState, type FormEvent } from 'react';

function codePointLength(value: string): number {
  return [...value].length;
}

function isPostedMessage(value: unknown): value is HouseChatSnapshotResponse['messages'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === 'string' &&
    typeof message.membershipId === 'string' &&
    typeof message.authorDisplayName === 'string' &&
    typeof message.body === 'string' &&
    typeof message.sequence === 'string' &&
    typeof message.createdAt === 'string'
  );
}

/** [BM-040] Accessible House chat composer and escaped message list. */
export function HouseChat({
  houseId,
  nightId,
  snapshot,
  nightState = 'live',
  acceptsMessages,
  onPosted,
  onDeleted,
}: {
  readonly houseId: string;
  readonly nightId: string;
  readonly snapshot: HouseChatSnapshotResponse;
  readonly nightState?: 'scheduled' | 'live' | 'ended';
  readonly acceptsMessages: boolean;
  readonly onPosted: (message: HouseChatSnapshotResponse['messages'][number]) => void;
  readonly onDeleted: (messageId: string) => void;
}) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [actionError, setActionError] = useState('');
  const bodyLength = codePointLength(body);
  const visibleFieldError =
    fieldError || (bodyLength > 2_000 ? 'House chat must be 1–2000 characters.' : '');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || !acceptsMessages || bodyLength < 1 || bodyLength > 2_000) return;
    setPending(true);
    setStatus('Sending your message.');
    setFieldError('');
    setActionError('');
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/nights/${encodeURIComponent(nightId)}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        const problem =
          typeof failure === 'object' && failure !== null
            ? (failure as Record<string, unknown>)
            : null;
        if (problem?.code === 'validation_failed') {
          setStatus('');
          setFieldError('House chat must be 1–2000 characters.');
          return;
        }
        throw new Error('House chat was not sent');
      }
      const saved: unknown = await response.json();
      if (!isPostedMessage(saved)) throw new Error('House chat response was invalid');
      onPosted(saved);
      setBody('');
      setStatus('Your message was sent.');
    } catch {
      setStatus('');
      setActionError("Your message wasn't sent. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function remove(messageId: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setActionError('');
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/nights/${encodeURIComponent(nightId)}/chat/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('House chat was not removed');
      onDeleted(messageId);
      setStatus('The message was removed.');
    } catch {
      setActionError("The message wasn't removed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="house-chat" aria-labelledby="house-chat-heading">
      <div>
        <p className="house-home__eyebrow">House gathering</p>
        <h2 id="house-chat-heading">House chat</h2>
        <p>One conversation for everyone at tonight’s table.</p>
      </div>
      <div className="house-chat__list" aria-label="House chat messages" aria-live="polite">
        {snapshot.messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          snapshot.messages.map((message) => (
            <article key={message.id} className="house-chat__message">
              <h3>{message.authorDisplayName}</h3>
              <p>{message.body}</p>
              {snapshot.canModerate ? (
                <button
                  type="button"
                  className="house-chat__remove"
                  onClick={() => void remove(message.id)}
                  disabled={pending}
                  aria-label={`Remove message from ${message.authorDisplayName}`}
                >
                  Remove
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>
      {acceptsMessages ? (
        <form className="house-chat__form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="house-chat-body">Your message</label>
          <textarea
            id="house-chat-body"
            required
            value={body}
            aria-invalid={visibleFieldError === '' ? undefined : true}
            aria-describedby={`house-chat-help house-chat-count${visibleFieldError === '' ? '' : ' house-chat-error'}`}
            onChange={(event) => {
              setBody(event.target.value);
              setFieldError('');
              setActionError('');
            }}
          />
          <div className="house-chat__form-meta">
            <span id="house-chat-help">Plain text, up to 2000 characters.</span>
            <span id="house-chat-count" aria-live="polite">
              {bodyLength}/2000
            </span>
          </div>
          <button type="submit" disabled={pending || bodyLength < 1 || bodyLength > 2_000}>
            {pending ? 'Sending…' : 'Send message'}
          </button>
          <p className="house-chat__status" aria-live="polite">
            {status}
          </p>
          {visibleFieldError === '' ? null : (
            <p id="house-chat-error" className="house-chat__error" role="alert">
              {visibleFieldError}
            </p>
          )}
          {actionError === '' ? null : (
            <p className="house-chat__error" role="alert">
              {actionError}
            </p>
          )}
        </form>
      ) : (
        <p>
          {nightState === 'ended'
            ? 'Chat closed when this Night ended.'
            : 'Chat opens when the Night goes live.'}
        </p>
      )}
    </section>
  );
}
