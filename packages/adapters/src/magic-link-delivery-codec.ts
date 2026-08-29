import type { MagicLinkDeliveryCodec, MagicLinkEmail } from '@between-moves/domain';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new Error('Magic-link sealing secret must be at least 32 characters');
  return createHash('sha256').update(secret, 'utf8').digest();
}

function parseMessage(value: unknown): MagicLinkEmail {
  if (!value || typeof value !== 'object') throw new Error('Invalid sealed magic-link payload');
  const { email, signInUrl } = value as Record<string, unknown>;
  if (typeof email !== 'string' || !email.includes('@') || typeof signInUrl !== 'string') {
    throw new Error('Invalid sealed magic-link payload');
  }
  const url = new URL(signInUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid sealed magic-link payload');
  }
  return { email, signInUrl: url.toString() };
}

/** [BM-008] [DR-ID-03] AES-256-GCM keeps token/email plaintext out of the durable outbox. */
export class AesGcmMagicLinkDeliveryCodec implements MagicLinkDeliveryCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = keyFromSecret(secret);
  }

  async seal(message: MagicLinkEmail): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  async open(sealed: string): Promise<MagicLinkEmail> {
    const envelope = Buffer.from(sealed, 'base64url');
    if (envelope.length <= IV_BYTES + TAG_BYTES) throw new Error('Invalid sealed magic-link payload');
    const iv = envelope.subarray(0, IV_BYTES);
    const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
    return parseMessage(JSON.parse(plaintext));
  }
}
