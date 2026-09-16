import type { MagicLinkDeliveryCodec, MagicLinkEmail } from '@between-moves/domain';
import { AesGcmDeliveryCodec } from './sealed-delivery-codec';

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
  private readonly codec: AesGcmDeliveryCodec<MagicLinkEmail>;

  constructor(secret: string) {
    this.codec = new AesGcmDeliveryCodec(secret, parseMessage);
  }

  seal(message: MagicLinkEmail): Promise<string> {
    return this.codec.seal(message);
  }

  open(sealed: string): Promise<MagicLinkEmail> {
    return this.codec.open(sealed);
  }
}
