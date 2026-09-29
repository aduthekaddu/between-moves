import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { AuthorizeHouseAction, MembershipRole } from './authorization';

/** [BM-015] One active Member as their House sees them. */
export interface HouseRosterMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly joinedAt: Date;
}

/**
 * [BM-015] The active Members of one House: the Owner first, then Stewards, then Members, each
 * group by name. It carries the viewer's own membership so a page can offer only what their
 * role permits.
 */
export interface HouseRoster {
  readonly houseId: string;
  readonly memberCap: number;
  readonly viewerMembershipId: string;
  readonly viewerRole: MembershipRole;
  readonly members: readonly HouseRosterMember[];
}

/** [BM-015] [DR-MEM-04] A roster read requires a House-issued context. */
export interface HouseRosterReadRepository {
  readRoster(context: AuthorizationContext): Promise<HouseRoster | null>;
}

export type PendingInvitationKind = 'shared' | 'single';

/**
 * [BM-014] A usable Invitation as its House administrators see it. Only the token digest is
 * stored, so a pending Invitation's link can never be shown again; it can only be revoked.
 */
export interface PendingInvitation {
  readonly invitationId: string;
  readonly kind: PendingInvitationKind;
  readonly intendedEmail: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly useLimit: number;
  readonly useCount: number;
  readonly creatorName: string;
}

/** [BM-014] Unrevoked, unexpired Invitations with uses left, newest first. */
export interface PendingInvitationReadRepository {
  listPending(context: AuthorizationContext, now: Date): Promise<readonly PendingInvitation[]>;
}

export interface ReadHouseRosterQuery {
  readonly houseId: string;
  readonly viewer: Viewer;
}

export interface ReadHouseRosterDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly roster: HouseRosterReadRepository;
}

export interface ReadPendingInvitationsDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly invitations: PendingInvitationReadRepository;
  readonly clock: Clock;
}
