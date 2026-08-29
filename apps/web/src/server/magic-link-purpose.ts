import { createHmac, timingSafeEqual } from 'node:crypto';

export type MagicLinkPurpose = 'signin' | 'recovery';

/** [BM-010] Bind a provider token to one public callback without persisting raw secrets. */
export function createMagicLinkPurposeProof(
  secret: string,
  purpose: MagicLinkPurpose,
  token: string,
): string {
  return createHmac('sha256', secret)
    .update('between-moves:magic-link-purpose\0')
    .update(purpose)
    .update('\0')
    .update(token)
    .digest('base64url');
}

export function verifyMagicLinkPurpose(
  secret: string,
  purpose: MagicLinkPurpose,
  token: string,
  proof: string | null,
): boolean {
  if (!proof) return false;
  const expected = Buffer.from(createMagicLinkPurposeProof(secret, purpose, token));
  const actual = Buffer.from(proof);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
