/* eslint-disable @next/next/no-img-element -- Native images avoid Next/Image inline styles under strict CSP. */
import type {
  HouseHome,
  HouseRoster,
  HouseRosterMember,
  MembershipRole,
  PendingInvitation,
} from '@between-moves/domain';
import houseCompany from '../../../_art/house-company.webp';
import { AppMasthead } from '../../../_components/app-masthead';
import { InvitePanel } from './invite-panel';
import { LeaveHouse } from './leave-house';
import { MemberActions } from './member-actions';
import { RevokeInvitationButton } from './revoke-invitation-button';

const ROLE_LABEL: Readonly<Record<MembershipRole, string>> = {
  owner: 'Owner',
  steward: 'Steward',
  member: 'Member',
};

function daysLabel(from: Date, to: Date): string {
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  return days === 1 ? '1 day' : `${days} days`;
}

/** [BM-015] Owners manage everyone but themselves; Stewards may only remove Members. */
function manageable(viewer: HouseRoster, member: HouseRosterMember): boolean {
  if (member.membershipId === viewer.viewerMembershipId || member.role === 'owner') return false;
  if (viewer.viewerRole === 'owner') return true;
  return viewer.viewerRole === 'steward' && member.role === 'member';
}

function InvitationRow({
  houseId,
  invitation,
  viewedAt,
  timeZone,
}: {
  readonly houseId: string;
  readonly invitation: PendingInvitation;
  readonly viewedAt: Date;
  readonly timeZone: string;
}) {
  const created = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(
    invitation.createdAt,
  );
  const label =
    invitation.kind === 'single'
      ? `For ${invitation.intendedEmail ?? 'one person'}`
      : 'Shared link';
  return (
    <li className="invitation-slip">
      <div className="invitation-slip__words">
        <strong>{label}</strong>
        <span>
          {invitation.creatorName} · {created} · {invitation.useCount} of {invitation.useLimit}{' '}
          {invitation.useLimit === 1 ? 'use' : 'uses'}
        </span>
        <span className="invitation-slip__expiry">
          Expires in {daysLabel(viewedAt, invitation.expiresAt)}
        </span>
      </div>
      <RevokeInvitationButton
        houseId={houseId}
        invitationId={invitation.invitationId}
        label={label}
      />
    </li>
  );
}

/** [BM-014] [BM-015] The House's roster, its open Invitations, and the way out. */
export function MembersView({
  home,
  roster,
  invitations,
  viewedAt,
}: {
  readonly home: HouseHome;
  readonly roster: HouseRoster;
  readonly invitations: readonly PendingInvitation[];
  readonly viewedAt: Date;
}) {
  const canInvite = roster.viewerRole !== 'member';
  const seatsLeft = Math.max(0, roster.memberCap - roster.members.length);
  const joined = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: home.timeZone });

  return (
    <div className="house-shell members-shell">
      <AppMasthead houseId={home.houseId} houseName={home.name} current="members" />
      <main className="members-page">
        <header className="members-heading">
          <div className="members-heading__words">
            <p className="house-home__eyebrow">Who is at the table</p>
            <h1>Members</h1>
            <p>
              {roster.members.length} of {roster.memberCap} seats taken.{' '}
              {seatsLeft === 0
                ? 'The House is full.'
                : 'A House stays small on purpose, so everyone knows everyone.'}
            </p>
          </div>
          <img
            className="members-heading__art"
            src={houseCompany.src}
            alt=""
            width={houseCompany.width}
            height={houseCompany.height}
          />
        </header>

        <div className="members-grid">
          <section className="members-roster" aria-labelledby="members-roster-title">
            <h2 id="members-roster-title">The House</h2>
            <ul className="roster">
              {roster.members.map((member) => {
                const isViewer = member.membershipId === roster.viewerMembershipId;
                return (
                  <li key={member.membershipId} className="roster__member" data-role={member.role}>
                    <span className="roster__chip" aria-hidden="true">
                      {Array.from(member.displayName)[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="roster__who">
                      <strong>
                        {member.displayName}
                        {isViewer ? <span className="roster__you">You</span> : null}
                      </strong>
                      <span className="roster__since">Joined {joined.format(member.joinedAt)}</span>
                    </span>
                    <span className="roster__role">{ROLE_LABEL[member.role]}</span>
                    {manageable(roster, member) ? (
                      <MemberActions
                        houseId={home.houseId}
                        member={{
                          membershipId: member.membershipId,
                          displayName: member.displayName,
                          role: member.role === 'steward' ? 'steward' : 'member',
                        }}
                        viewerIsOwner={roster.viewerRole === 'owner'}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="members-side">
            {canInvite ? (
              <InvitePanel houseId={home.houseId} seatsLeft={seatsLeft} />
            ) : (
              <section className="members-note" aria-labelledby="members-invite-note-title">
                <h2 id="members-invite-note-title">Bringing a friend?</h2>
                <p>
                  Ask{' '}
                  {roster.members.find((member) => member.role === 'owner')?.displayName ??
                    'the Owner'}{' '}
                  or a Steward for an invitation link. Houses open only by invitation.
                </p>
              </section>
            )}

            {canInvite ? (
              <section className="members-invitations" aria-labelledby="members-pending-title">
                <h2 id="members-pending-title">Open invitations</h2>
                {invitations.length === 0 ? (
                  <p className="members-invitations__empty">
                    No invitations are waiting. Links you create appear here until they are used,
                    revoked, or expire.
                  </p>
                ) : (
                  <ul className="invitation-slips">
                    {invitations.map((invitation) => (
                      <InvitationRow
                        key={invitation.invitationId}
                        houseId={home.houseId}
                        invitation={invitation}
                        viewedAt={viewedAt}
                        timeZone={home.timeZone}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <LeaveHouse
              houseId={home.houseId}
              houseName={home.name}
              isOwner={roster.viewerRole === 'owner'}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
