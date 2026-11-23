import type { NudgeEmail, VerifiedNudgeDelivery } from '../delivery';

/** [BM-029] Test-only delivery; production deliveries are issued by the Nudge delivery gate. */
export function fakeVerifiedNudgeDelivery(email: NudgeEmail): VerifiedNudgeDelivery {
  return email as VerifiedNudgeDelivery;
}
