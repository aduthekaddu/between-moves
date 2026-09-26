import { createHmac, timingSafeEqual } from 'node:crypto';

/** [BM-044] Sign the exact callback body; the engine shares this secret with the app. */
export function signAnalysisCallback(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function verifyAnalysisCallback(secret: string, body: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signAnalysisCallback(secret, body), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return timingSafeEqual(expected, actual);
}
