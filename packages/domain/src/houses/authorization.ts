import type { Viewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import { AuthorizationDeniedError } from '../shared/errors';

export type MembershipRole = 'owner' | 'steward' | 'member';
export type MembershipStatus = 'active' | 'left' | 'removed';

export type HouseAction =
  | { readonly kind: 'view_house_content' }
  | { readonly kind: 'create_or_join_game' }
  | { readonly kind: 'write_house_chat_or_game_note' }
  | { readonly kind: 'moderate_house_chat' }
  | { readonly kind: 'set_game_reaction' }
  | { readonly kind: 'leave_house' }
  | { readonly kind: 'create_member_invite' }
  | { readonly kind: 'revoke_invite' }
  | { readonly kind: 'draft_or_publish_charter' }
  | { readonly kind: 'close_season' }
  | { readonly kind: 'schedule_night' }
  | {
      readonly kind: 'start_or_end_assigned_night';
      readonly nightId: string;
      readonly operation?: 'start' | 'end';
    }
  | { readonly kind: 'remove_member'; readonly targetMembershipId: string }
  | { readonly kind: 'change_permanent_role' }
  | { readonly kind: 'transfer_ownership' }
  | { readonly kind: 'delete_house' };

export type HouseAuthorizationEvaluation =
  | Exclude<HouseAction, { readonly kind: 'start_or_end_assigned_night' | 'remove_member' }>
  | { readonly kind: 'start_or_end_assigned_night'; readonly assignedNightHost: boolean }
  | { readonly kind: 'remove_member'; readonly targetRole: MembershipRole | null };

export interface HouseAuthorizationMembership {
  readonly membershipId: string;
  readonly houseId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
}

export interface HouseAuthorizationMembershipRepository {
  findMembership(input: {
    readonly houseId: string;
    readonly viewerId: string;
  }): Promise<HouseAuthorizationMembership | null>;
  findMembershipById(input: {
    readonly houseId: string;
    readonly membershipId: string;
  }): Promise<HouseAuthorizationMembership | null>;
}

export interface HouseNightHostAssignmentRepository {
  /**
   * Verify the assigned membership on the requested House Night.
   * Start is limited to scheduled/live; end remains valid on ended Nights for idempotent replay.
   * Cancelled Nights never grant host duty.
   */
  isAssignedNightHost(input: {
    readonly houseId: string;
    readonly nightId: string;
    readonly membershipId: string;
    readonly operation?: 'start' | 'end';
  }): Promise<boolean>;
}

export type HouseAuthorizationDenialReason =
  | 'not_authenticated'
  | 'not_a_member'
  | 'inactive_membership'
  | 'role_not_permitted'
  | 'night_host_not_assigned'
  | 'protected_member';

export interface HouseAuthorizationDenial {
  readonly action: HouseAction['kind'];
  readonly actorId: string | 'anonymous';
  readonly houseId: string;
  readonly reason: HouseAuthorizationDenialReason;
  readonly crossHouse: boolean;
}

export interface HouseAuthorizationDenialRecorder {
  record(denial: HouseAuthorizationDenial): void;
}

export interface HouseAuthorizationDependencies {
  readonly memberships: HouseAuthorizationMembershipRepository;
  readonly nightHosts: HouseNightHostAssignmentRepository;
  readonly denials: HouseAuthorizationDenialRecorder;
}

export type AuthorizeHouseAction = (
  action: HouseAction,
  houseId: string,
  viewer: Viewer,
) => Promise<AuthorizationContext>;

export class HouseAuthorizationDeniedError extends AuthorizationDeniedError {
  constructor(
    readonly reason: HouseAuthorizationDenialReason,
    readonly crossHouse: boolean,
  ) {
    super('House action is not authorized');
  }
}

/** [BM-012] [DR-PERM-01..03] Evaluate one active House membership against the matrix. */
export function houseAuthorizationDenialReason(
  action: HouseAuthorizationEvaluation,
  membership: HouseAuthorizationMembership,
): HouseAuthorizationDenialReason | null {
  switch (action.kind) {
    case 'view_house_content':
    case 'create_or_join_game':
    case 'write_house_chat_or_game_note':
    case 'set_game_reaction':
    case 'leave_house':
      return null;
    case 'moderate_house_chat':
    case 'create_member_invite':
    case 'revoke_invite':
    case 'draft_or_publish_charter':
    case 'close_season':
    case 'schedule_night':
      return membership.role === 'member' ? 'role_not_permitted' : null;
    case 'start_or_end_assigned_night':
      if (membership.role !== 'member') return null;
      return action.assignedNightHost ? null : 'night_host_not_assigned';
    case 'remove_member':
      if (membership.role === 'owner') return null;
      if (membership.role === 'member') return 'role_not_permitted';
      return action.targetRole === 'member' ? null : 'protected_member';
    case 'change_permanent_role':
    case 'transfer_ownership':
    case 'delete_house':
      return membership.role === 'owner' ? null : 'role_not_permitted';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
