import { describe, expect, it } from 'vitest';
import { createMagicLinkPurposeProof, verifyMagicLinkPurpose } from './magic-link-purpose';

const secret = 'purpose-proof-secret-with-at-least-32-characters';
const token = 'opaque-magic-link-token';

describe('magic-link purpose proof', () => {
  it('[BM-010] binds a callback proof to both its token and recovery purpose', () => {
    const proof = createMagicLinkPurposeProof(secret, 'recovery', token);

    expect(verifyMagicLinkPurpose(secret, 'recovery', token, proof)).toBe(true);
    expect(verifyMagicLinkPurpose(secret, 'signin', token, proof)).toBe(false);
    expect(verifyMagicLinkPurpose(secret, 'recovery', `${token}-other`, proof)).toBe(false);
    expect(verifyMagicLinkPurpose(secret, 'recovery', token, 'forged-proof')).toBe(false);
  });
});
