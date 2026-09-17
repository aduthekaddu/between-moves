import {
  HouseAuthorizationDeniedError,
  houseAuthorizationDenialReason,
  type AuthorizationContext,
  type AuthorizeHouseAction,
  type HouseAction,
  type HouseAuthorizationDenialReason,
  type HouseAuthorizationDependencies,
  type HouseAuthorizationEvaluation,
  type HouseAuthorizationMembership,
  type Viewer,
} from '@between-moves/domain';

function issueAuthorizationContext(input: {
  readonly viewerId: string;
  readonly houseId: string;
}): AuthorizationContext {
  return input as AuthorizationContext;
}

function deny(
  dependencies: HouseAuthorizationDependencies,
  action: HouseAction,
  houseId: string,
  actorId: string | 'anonymous',
  reason: HouseAuthorizationDenialReason,
  crossHouse: boolean,
): never {
  dependencies.denials.record({ action: action.kind, actorId, houseId, reason, crossHouse });
  throw new HouseAuthorizationDeniedError(reason, crossHouse);
}

async function resolveEvaluation(
  action: HouseAction,
  membership: HouseAuthorizationMembership,
  dependencies: HouseAuthorizationDependencies,
): Promise<HouseAuthorizationEvaluation> {
  switch (action.kind) {
    case 'start_or_end_assigned_night':
      return {
        kind: action.kind,
        assignedNightHost:
          membership.role === 'member' &&
          (await dependencies.nightHosts.isAssignedNightHost({
            houseId: membership.houseId,
            nightId: action.nightId,
            membershipId: membership.membershipId,
            ...(action.operation === undefined ? {} : { operation: action.operation }),
          })),
      };
    case 'remove_member': {
      const target =
        membership.role === 'steward'
          ? await dependencies.memberships.findMembershipById({
              houseId: membership.houseId,
              membershipId: action.targetMembershipId,
            })
          : null;
      return {
        kind: action.kind,
        targetRole: target?.role ?? null,
      };
    }
    case 'view_house_content':
    case 'create_or_join_game':
    case 'write_house_chat_or_game_note':
    case 'set_game_reaction':
    case 'leave_house':
    case 'create_member_invite':
    case 'revoke_invite':
    case 'draft_or_publish_charter':
    case 'schedule_night':
    case 'change_permanent_role':
    case 'transfer_ownership':
    case 'delete_house':
      return action;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** [BM-012] [DR-PERM-01..03] Build the single House permission authority. */
export function createAuthorizeHouseAction(
  dependencies: HouseAuthorizationDependencies,
): AuthorizeHouseAction {
  return async (action: HouseAction, houseId: string, viewer: Viewer) => {
    if (viewer.kind === 'anonymous') {
      return deny(dependencies, action, houseId, 'anonymous', 'not_authenticated', false);
    }

    const membership = await dependencies.memberships.findMembership({
      houseId,
      viewerId: viewer.userId,
    });
    if (membership === null) {
      return deny(dependencies, action, houseId, viewer.userId, 'not_a_member', true);
    }
    if (membership.status !== 'active') {
      return deny(dependencies, action, houseId, viewer.userId, 'inactive_membership', false);
    }

    const evaluation = await resolveEvaluation(action, membership, dependencies);
    const reason = houseAuthorizationDenialReason(evaluation, membership);
    if (reason !== null) {
      return deny(dependencies, action, houseId, viewer.userId, reason, false);
    }

    return issueAuthorizationContext({ viewerId: viewer.userId, houseId });
  };
}
