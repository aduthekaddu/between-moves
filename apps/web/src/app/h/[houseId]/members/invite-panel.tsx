'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  newIdempotencyKey,
  postHouseCommand,
  problemDetail,
} from '../../../_components/house-command';

type InvitationKind = 'shared' | 'single';

interface CreatedInvitation {
  readonly url: string;
  readonly expiresAt: string;
  readonly kind: InvitationKind;
  readonly email: string | null;
}

function createdInvitation(body: unknown): { token: string; expiresAt: string } | null {
  if (body === null || typeof body !== 'object') return null;
  if (!('token' in body) || typeof body.token !== 'string') return null;
  if (!('expiresAt' in body) || typeof body.expiresAt !== 'string') return null;
  return { token: body.token, expiresAt: body.expiresAt };
}

function failureMessage(status: number, body: unknown): string {
  if (status === 429) return 'Too many invitations just now. Wait a little and try again.';
  if (status === 409) return problemDetail(body) ?? 'The House is full, so no one else can join.';
  if (status === 422) return 'Check the email address and try again.';
  if (status === 401) return 'Your session expired. Sign in again to invite someone.';
  if (status === 403) return 'Only the Owner and Stewards can invite people.';
  return 'The invitation could not be created. Try again.';
}

/** [BM-014] Create a shared or single-email Invitation. Its link exists only in this response. */
export function InvitePanel({
  houseId,
  seatsLeft,
}: {
  readonly houseId: string;
  readonly seatsLeft: number;
}) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<InvitationKind>('shared');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  // one key per intended invitation, so a double click or a retry after a lost reply is safe
  const idempotencyKey = useRef(newIdempotencyKey());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    setCopied(false);
    const trimmed = email.trim();
    const outcome = await postHouseCommand(
      `/api/houses/${encodeURIComponent(houseId)}/invitations`,
      {
        body: kind === 'single' ? { kind, intendedEmail: trimmed } : { kind },
        idempotencyKey: idempotencyKey.current,
      },
    );
    setPending(false);
    const invitation = outcome.ok ? createdInvitation(outcome.body) : null;
    if (invitation === null) {
      setError(
        outcome.status === 0
          ? 'Could not connect. Check your connection and try again.'
          : failureMessage(outcome.status, outcome.body),
      );
      return;
    }
    idempotencyKey.current = newIdempotencyKey();
    setCreated({
      url: new URL(
        `/invitations/${encodeURIComponent(invitation.token)}`,
        window.location.origin,
      ).toString(),
      expiresAt: invitation.expiresAt,
      kind,
      email: kind === 'single' ? trimmed : null,
    });
    setEmail('');
    router.refresh();
    requestAnimationFrame(() => linkField.current?.select());
  }

  async function copy() {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      linkField.current?.select();
      setError('Copying is blocked here. The link is selected: copy it with your keyboard.');
    }
  }

  const full = seatsLeft === 0;
  return (
    <section id="invite" className="invite-panel" aria-labelledby={`${id}-title`}>
      <p className="house-home__eyebrow">Invitations</p>
      <h2 id={`${id}-title`}>Invite someone</h2>
      <p className="invite-panel__lede">
        {full
          ? 'Every seat is taken. Someone has to leave before anyone else can join.'
          : `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left. Links last seven days.`}
      </p>

      <form className="invite-form" onSubmit={(event) => void submit(event)}>
        <fieldset className="invite-form__kinds" disabled={full || pending}>
          <legend className="visually-hidden">Kind of invitation</legend>
          <label className="invite-kind">
            <input
              type="radio"
              name="kind"
              value="shared"
              checked={kind === 'shared'}
              onChange={() => setKind('shared')}
            />
            <span>
              <strong>A link to share</strong>
              <span>Anyone with it can join until the seats run out.</span>
            </span>
          </label>
          <label className="invite-kind">
            <input
              type="radio"
              name="kind"
              value="single"
              checked={kind === 'single'}
              onChange={() => setKind('single')}
            />
            <span>
              <strong>One person, by email</strong>
              <span>We email them a link that works only for that address.</span>
            </span>
          </label>
        </fieldset>

        {kind === 'single' ? (
          <div className="invite-form__field">
            <label htmlFor={`${id}-email`}>Their email address</label>
            <input
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              value={email}
              disabled={full || pending}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </div>
        ) : null}

        {error === '' ? null : (
          <p className="invite-form__error" role="alert">
            {error}
          </p>
        )}

        <button className="invite-form__submit" type="submit" disabled={full || pending}>
          {pending ? 'Creating…' : kind === 'single' ? 'Send invitation' : 'Create invitation link'}
        </button>
      </form>

      {created === null ? null : (
        <div className="invite-created" role="status">
          <p className="invite-created__note">
            {created.kind === 'single' && created.email !== null
              ? `We’re emailing ${created.email}. You can also send this link yourself.`
              : 'Here is your link.'}{' '}
            <strong>Copy it now: it is never shown again.</strong>
          </p>
          <label className="visually-hidden" htmlFor={`${id}-link`}>
            Invitation link
          </label>
          <div className="invite-created__row">
            <input
              ref={linkField}
              id={`${id}-link`}
              className="invite-created__link"
              readOnly
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="invite-created__expiry">
            Expires{' '}
            <time dateTime={created.expiresAt}>
              {new Date(created.expiresAt).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
          </p>
        </div>
      )}
    </section>
  );
}
