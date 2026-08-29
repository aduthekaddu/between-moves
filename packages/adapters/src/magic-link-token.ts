import { randomBytes } from 'node:crypto';

/** [BM-008] [DR-ID-03] Generate exactly 32 CSPRNG bytes for a URL-safe token. */
export function generateMagicLinkToken(): string {
  return randomBytes(32).toString('base64url');
}
