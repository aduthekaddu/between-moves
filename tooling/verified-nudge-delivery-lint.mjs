// [BM-029] Only PgNudgeDeliveryGate.pass may mint a VerifiedNudgeDelivery. The brand is a type, so
// a type assertion is the one way to forge it; this config rejects every such assertion.
const message =
  'Do not assert a value to VerifiedNudgeDelivery. Get one from PgNudgeDeliveryGate.pass (packages/db/src/pg-nudge-delivery-gate.ts), which checks the Nudge is still due. Tests use fakeVerifiedNudgeDelivery from @between-moves/domain/testing.';

const target = 'TSTypeReference[typeName.name="VerifiedNudgeDelivery"]';

export const verifiedNudgeDeliveryAllowedFiles = [
  'packages/db/src/pg-nudge-delivery-gate.ts',
  'packages/domain/src/testing/fake-verified-nudge-delivery.ts',
];

export const rejectVerifiedNudgeDeliveryAssertion = [
  'error',
  { selector: `TSAsExpression > ${target}`, message },
  { selector: `TSTypeAssertion > ${target}`, message },
];
