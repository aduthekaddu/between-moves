import type { AuthorizedUseCase } from '../shared/use-case';

/** [BM-005] House-scoped application contract; behavior arrives with its owning ticket. */
export type HousesUseCase<Command, Result> = AuthorizedUseCase<Command, Result>;

export { createHouse } from './create-house';
export { createInvitation } from './create-invitation';
export { inspectInvitation } from './inspect-invitation';
export { revokeInvitation } from './revoke-invitation';
export { createAuthorizeHouseAction } from './authorize-house-action';
export { readHouseHome } from './read-house-home';
export {
  changeMembershipRole,
  leaveHouse,
  removeHouseMember,
  transferHouseOwnership,
} from './membership-admin';
