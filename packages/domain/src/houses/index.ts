export type { HouseReference, HouseReferenceRepository } from './reference-repository';
export type {
  HouseHome,
  HouseHomeReadRepository,
  ReadHouseHomeDependencies,
  ReadHouseHomeQuery,
} from './house-home';
export { createHouseEmblemSeed, createHouseSlug, validateCreateHouseCommand } from './house';
export type {
  CreateHouseCommand,
  HouseCreationDependencies,
  HouseCreationInput,
  HouseCreationRepository,
  HouseCreationResult,
  IdGenerator,
  ValidatedCreateHouseCommand,
} from './house';
export { HouseAuthorizationDeniedError, houseAuthorizationDenialReason } from './authorization';
export type {
  AuthorizeHouseAction,
  HouseAction,
  HouseAuthorizationDenial,
  HouseAuthorizationDenialReason,
  HouseAuthorizationDenialRecorder,
  HouseAuthorizationDependencies,
  HouseAuthorizationEvaluation,
  HouseAuthorizationMembership,
  HouseAuthorizationMembershipRepository,
  HouseNightHostAssignmentRepository,
  MembershipRole,
  MembershipStatus,
} from './authorization';
export { invitationCreationPolicy } from './invitation';
export type {
  CreateInvitationCommand,
  CreateInvitationRequest,
  InspectInvitationRequest,
  InvitationCreationDependencies,
  InvitationCreationInput,
  InvitationCreationPolicy,
  InvitationCreationPolicyContext,
  InvitationCreationRepository,
  InvitationCreationResult,
  InvitationInspectionDependencies,
  InvitationInspectionInput,
  InvitationInspectionRepository,
  InvitationPreview,
  InvitationRevocationDependencies,
  InvitationRevocationInput,
  InvitationRevocationRepository,
  InvitationRevocationResult,
  InvitationToken,
  InvitationTokenDigester,
  InvitationTokenIssueRequest,
  InvitationTokenIssuer,
  PersistedInvitationCreation,
  SharedInvitationCommand,
  SingleInvitationCommand,
  RevokeInvitationRequest,
} from './invitation';
export type {
  ChangeMembershipRoleRequest,
  LeaveHouseRequest,
  MembershipAdminDependencies,
  MembershipAdminRepository,
  MembershipLeaveInput,
  MembershipLeaveResult,
  MembershipRemovalInput,
  MembershipRemovalResult,
  MembershipRoleChangeInput,
  MembershipRoleChangeResult,
  OwnershipTransferInput,
  OwnershipTransferReplayQuery,
  OwnershipTransferResult,
  PermanentMembershipRole,
  RemoveHouseMemberRequest,
  TransferHouseOwnershipRequest,
} from './membership-admin';

/** [BM-005] Logical House module boundary and future authorization authority. */
export interface HousesPorts {
  readonly module: 'houses';
}
