export type { AuthorizedUseCase, UseCase } from './shared/use-case';
export type { IdentityUseCase } from './identity';
export { createViewerResolver, type ViewerResolver } from './identity';
export {
  createAuthorizeHouseAction,
  createHouse,
  createInvitation,
  changeMembershipRole,
  inspectInvitation,
  leaveHouse,
  readHouseHome,
  removeHouseMember,
  redeemInvitation,
  revokeInvitation,
  transferHouseOwnership,
} from './houses';
export type { HousesUseCase } from './houses';
export type { SeasonsUseCase } from './seasons';
export { draftSeason, draftSeasonCharter, publishSeason, readHouseSeason } from './seasons';
export type { GamesUseCase } from './games';
export { acceptGameSeat, createGameSeat } from './games';
export type { NightsUseCase } from './nights';
export { changeNightSchedule, readScheduledNights } from './nights';
export type { StoriesUseCase } from './stories';
export {
  createOutboxDispatcher,
  type DispatchSummary,
  type OutboxDispatcher,
  type OutboxDispatcherOptions,
} from './delivery';

export {
  createMagicLinkDeliveryQueue,
  createMagicLinkEmailConsumer,
  MAGIC_LINK_EMAIL_TOPIC,
  type MagicLinkDeliveryQueueDependencies,
  type QueueMagicLinkDelivery,
} from './identity';

export {
  createCompleteAccountRecovery,
  createDiscardRecoveredSession,
  createRequestAccountRecovery,
  type CompleteAccountRecoveryDependencies,
  type DiscardRecoveredSessionDependencies,
  type RequestAccountRecoveryDependencies,
} from './identity';
