import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new Error('Delivery sealing secret must be at least 32 characters');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export class AesGcmDeliveryCodec<Message> {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly parse: (value: unknown) => Message,
  ) {
    this.key = keyFromSecret(secret);
  }

  async seal(message: Message): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  async open(sealed: string): Promise<Message> {
    const envelope = Buffer.from(sealed, 'base64url');
    if (envelope.length <= IV_BYTES + TAG_BYTES) throw new Error('Invalid sealed delivery payload');
    const iv = envelope.subarray(0, IV_BYTES);
    const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
    return this.parse(JSON.parse(plaintext));
  }
}
