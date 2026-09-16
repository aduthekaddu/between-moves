'use client';

import { useState, type FormEvent } from 'react';

interface GameNoteItem {
  readonly membershipId: string;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly createdAt: string | Date;
  readonly editedAt: string | Date | null;
}

interface GameNotesView {
  readonly currentMembershipId: string;
  readonly notes: readonly GameNoteItem[];
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isSavedNote(value: unknown): value is GameNoteItem {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.membershipId === 'string' &&
    typeof note.authorDisplayName === 'string' &&
    typeof note.body === 'string' &&
    typeof note.createdAt === 'string' &&
    (typeof note.editedAt === 'string' || note.editedAt === null)
  );
}

/** [BM-032] Accessible editor and escaped House-visible Game-note list. */
export function GameNotes({
  houseId,
  gameId,
  initial,
}: {
  readonly houseId: string;
  readonly gameId: string;
  readonly initial: GameNotesView;
}) {
  const [notes, setNotes] = useState(initial.notes);
  const current = notes.find((note) => note.membershipId === initial.currentMembershipId);
  const [body, setBody] = useState(current?.body ?? '');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [actionError, setActionError] = useState('');
  const bodyLength = codePointLength(body);
  const visibleFieldError =
    fieldError || (bodyLength > 2_000 ? 'Game notes must be 1–2000 characters.' : '');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || bodyLength < 1 || bodyLength > 2_000) return;
    setPending(true);
    setStatus('Saving your Game note.');
    setFieldError('');
    setActionError('');
    try {
      const response = await fetch(
        `/api/houses/${encodeURIComponent(houseId)}/games/${encodeURIComponent(gameId)}/note`,
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
          setFieldError('Game notes must be 1–2000 characters.');
          return;
        }
        throw new Error('Game note was not saved');
      }
      const saved: unknown = await response.json();
      if (!isSavedNote(saved) || saved.membershipId !== initial.currentMembershipId) {
        throw new Error('Game note response was invalid');
      }
      setNotes((existing) => {
        const withoutCurrent = existing.filter(
          (note) => note.membershipId !== initial.currentMembershipId,
        );
        return [...withoutCurrent, saved].sort((left, right) =>
          String(left.createdAt).localeCompare(String(right.createdAt)),
        );
      });
      setStatus(current === undefined ? 'Your Game note was added.' : 'Your changes were saved.');
    } catch {
      setStatus('');
      setActionError("Your Game note wasn't saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="game-notes" aria-labelledby="game-notes-heading">
      <div>
        <p className="house-home__eyebrow">House story</p>
        <h2 id="game-notes-heading">Game notes</h2>
        <p>Leave one post-game reflection for the House.</p>
      </div>
      <form className="game-notes__form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="game-note-body">Your post-game note</label>
        <textarea
          id="game-note-body"
          required
          value={body}
          aria-invalid={visibleFieldError === '' ? undefined : true}
          aria-describedby={`game-note-help game-note-count${visibleFieldError === '' ? '' : ' game-note-error'}`}
          onChange={(event) => {
            setBody(event.target.value);
            setFieldError('');
            setActionError('');
          }}
        />
        <div className="game-notes__form-meta">
          <span id="game-note-help">Plain text, up to 2000 characters.</span>
          <span id="game-note-count" aria-live="polite">
            {bodyLength}/2000
          </span>
        </div>
        <button type="submit" disabled={pending || bodyLength < 1 || bodyLength > 2_000}>
          {pending ? 'Saving…' : current === undefined ? 'Add note' : 'Save changes'}
        </button>
        <p className="game-notes__status" aria-live="polite">
          {status}
        </p>
        {visibleFieldError === '' ? null : (
          <p id="game-note-error" className="game-notes__error" role="alert">
            {visibleFieldError}
          </p>
        )}
        {actionError === '' ? null : (
          <p className="game-notes__error" role="alert">
            {actionError}
          </p>
        )}
      </form>
      <div className="game-notes__list" aria-label="Members’ Game notes">
        {notes.length === 0 ? (
          <p>No Game notes yet.</p>
        ) : (
          notes.map((note) => (
            <article key={note.membershipId} className="game-notes__note">
              <h3>{note.authorDisplayName}</h3>
              <p>{note.body}</p>
              {note.editedAt === null ? null : <small>Edited</small>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
