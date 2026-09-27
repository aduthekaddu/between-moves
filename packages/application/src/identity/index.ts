export { createViewerResolver, type ViewerResolver } from './viewer';

export {
  createMagicLinkDeliveryQueue,
  createMagicLinkEmailConsumer,
  MAGIC_LINK_EMAIL_TOPIC,
  type MagicLinkDeliveryQueueDependencies,
  type QueueMagicLinkDelivery,
} from './magic-link';

export {
  createCompleteAccountRecovery,
  createDiscardRecoveredSession,
  createRequestAccountRecovery,
  type CompleteAccountRecoveryDependencies,
  type DiscardRecoveredSessionDependencies,
  type RequestAccountRecoveryDependencies,
} from './recovery';

export {
  createDeleteAccount,
  createExportAccountData,
  createReadAccountSummary,
} from './data-rights';
