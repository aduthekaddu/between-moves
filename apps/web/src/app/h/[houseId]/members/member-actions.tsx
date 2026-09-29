'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  newIdempotencyKey,
  postHouseCommand,
  problemDetail,
} from '../../../_components/house-command';

type Confirming = 'remove' | 'transfer' | null;

interface ManagedMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: 'member' | 'steward';
}

function failure(status: number, body: unknown, fallback: string): string {
  if (status === 0) return 'Could not connect. Check your connection and try again.';
  if (status === 401) return 'Your session expired. Sign in again to manage Members.';
  if (status === 403) return 'Your role in this House does not allow that.';
  if (status === 404) return 'That Member is no longer in the House. Refresh the page.';
  return problemDetail(body) ?? fallback;
}

/**
 * [BM-015] Owner and Steward controls for one Member. Removal and handing over the House each
 * take a second, explicit step; the Owner's own row never shows these controls.
 */
export function MemberActions({
  houseId,
  member,
  viewerIsOwner,
}: {
  readonly houseId: string;
  readonly member: ManagedMember;
  readonly viewerIsOwner: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [transferred, setTransferred] = useState(false);
  const transferKey = useRef(newIdempotencyKey());
  const base = `/api/houses/${encodeURIComponent(houseId)}`;
  const memberPath = `${base}/members/${encodeURIComponent(member.membershipId)}`;

  async function run(
    url: string,
    options: Parameters<typeof postHouseCommand>[1],
    fallback: string,
    after: () => void,
  ) {
    if (pending) return;
    setPending(true);
    setError('');
    const outcome = await postHouseCommand(url, options);
    setPending(false);
    if (!outcome.ok) {
      setError(failure(outcome.status, outcome.body, fallback));
      return;
    }
    setConfirming(null);
    after();
  }

  if (transferred) {
    return (
      <div className="member-actions member-actions--done" role="status">
        <p>
          {member.displayName} now owns the House. You have been signed out everywhere, as they
          have.
        </p>
        <Link href="/sign-in">Sign in again</Link>
      </div>
    );
  }

  const nextRole = member.role === 'steward' ? 'member' : 'steward';
  return (
    <details className="member-actions">
      <summary>
        Manage <span className="visually-hidden">{member.displayName}</span>
      </summary>
      <div className="member-actions__panel">
        {confirming === null ? (
          <div className="member-actions__buttons">
            {viewerIsOwner ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void run(
                    `${memberPath}/role`,
                    { body: { role: nextRole } },
                    'The role could not be changed.',
                    () => router.refresh(),
                  )
                }
              >
                {pending ? 'Saving…' : nextRole === 'steward' ? 'Make Steward' : 'Make Member'}
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => setConfirming('remove')}>
              Remove from House
            </button>
            {viewerIsOwner ? (
              <button type="button" disabled={pending} onClick={() => setConfirming('transfer')}>
                Hand over the House
              </button>
            ) : null}
          </div>
        ) : confirming === 'remove' ? (
          <div className="member-actions__confirm" role="group" aria-label="Confirm removal">
            <p>
              Remove {member.displayName}? They lose access at once and are signed out. Their Games
              and results stay in the House’s history.
            </p>
            <div className="member-actions__buttons">
              <button type="button" disabled={pending} onClick={() => setConfirming(null)}>
                Keep {member.displayName}
              </button>
              <button
                type="button"
                className="member-actions__danger"
                disabled={pending}
                onClick={() =>
                  void run(`${memberPath}/remove`, {}, 'The Member could not be removed.', () =>
                    router.refresh(),
                  )
                }
              >
                {pending ? 'Removing…' : `Remove ${member.displayName}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="member-actions__confirm" role="group" aria-label="Confirm handover">
            <p>
              Hand the House to {member.displayName}? They become the Owner and you become a Member.
              You will both be signed out on every device and need to sign in again.
            </p>
            <div className="member-actions__buttons">
              <button type="button" disabled={pending} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="member-actions__danger"
                disabled={pending}
                onClick={() =>
                  void run(
                    `${base}/transfer`,
                    {
                      body: { toMembershipId: member.membershipId },
                      idempotencyKey: transferKey.current,
                    },
                    'Ownership could not be transferred.',
                    () => setTransferred(true),
                  )
                }
              >
                {pending ? 'Handing over…' : `Make ${member.displayName} the Owner`}
              </button>
            </div>
          </div>
        )}
        {error === '' ? null : (
          <p className="member-actions__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
