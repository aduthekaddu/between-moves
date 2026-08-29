export type { HouseReference, HouseReferenceRepository } from './reference-repository';
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

/** [BM-005] Logical House module boundary and future authorization authority. */
export interface HousesPorts {
  readonly module: 'houses';
}
