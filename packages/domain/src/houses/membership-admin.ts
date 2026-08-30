import type { AuthenticatedViewer } from '../identity';
import type { AuthorizationContext } from '../shared/authorization-context';
import type { Clock } from '../shared/clock';
import type { AuthorizeHouseAction, MembershipRole } from './authorization';
import type { IdGenerator } from './house';

export type PermanentMembershipRole = Exclude<MembershipRole, 'owner'>;

export interface ChangeMembershipRoleRequest {
  readonly houseId: string;
  readonly targetMembershipId: string;
  readonly role: PermanentMembershipRole;
  readonly viewer: AuthenticatedViewer;
}

export interface MembershipRoleChangeInput {
  readonly targetMembershipId: string;
  readonly role: PermanentMembershipRole;
  readonly auditId: string;
  readonly changedAt: Date;
}

export interface MembershipRoleChangeResult {
  readonly membershipId: string;
  readonly role: PermanentMembershipRole;
  readonly changed: boolean;
  /** Prior identifiers made unusable; the next sign-in mints a fresh session identifier. */
  readonly invalidatedSessionCount: number;
}

export interface RemoveHouseMemberRequest {
  readonly houseId: string;
  readonly targetMembershipId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface MembershipRemovalInput {
  readonly targetMembershipId: string;
  readonly auditId: string;
  readonly removedAt: Date;
}

export interface MembershipRemovalResult {
  readonly membershipId: string;
  readonly removedNow: boolean;
  readonly invalidatedSessionCount: number;
}

export interface LeaveHouseRequest {
  readonly houseId: string;
  readonly viewer: AuthenticatedViewer;
}

export interface MembershipLeaveInput {
  readonly auditId: string;
  readonly leftAt: Date;
}

export interface MembershipLeaveResult {
  readonly membershipId: string;
  readonly leftNow: boolean;
}

export interface TransferHouseOwnershipRequest {
  readonly houseId: string;
  readonly targetMembershipId: string;
  readonly idempotencyKey: string;
  readonly viewer: AuthenticatedViewer;
}

export interface OwnershipTransferInput {
  readonly targetMembershipId: string;
  readonly idempotencyKey: string;
  readonly auditId: string;
  readonly transferredAt: Date;
}

export interface OwnershipTransferResult {
  readonly previousOwnerMembershipId: string;
  readonly ownerMembershipId: string;
  readonly changed: boolean;
  /** Prior identifiers made unusable; the next sign-in mints a fresh session identifier. */
  readonly invalidatedSessionCount: number;
}

export interface OwnershipTransferReplayQuery {
  readonly targetMembershipId: string;
  readonly idempotencyKey: string;
}

export interface MembershipAdminRepository {
  findOwnershipTransferReplay(
    context: AuthorizationContext,
    query: OwnershipTransferReplayQuery,
  ): Promise<OwnershipTransferResult | null>;
  changeRole(
    context: AuthorizationContext,
    input: MembershipRoleChangeInput,
  ): Promise<MembershipRoleChangeResult>;
  remove(
    context: AuthorizationContext,
    input: MembershipRemovalInput,
  ): Promise<MembershipRemovalResult>;
  leave(context: AuthorizationContext, input: MembershipLeaveInput): Promise<MembershipLeaveResult>;
  transferOwnership(
    context: AuthorizationContext,
    input: OwnershipTransferInput,
  ): Promise<OwnershipTransferResult>;
}

export interface MembershipAdminDependencies {
  readonly authorizeHouseAction: AuthorizeHouseAction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly memberships: MembershipAdminRepository;
}
