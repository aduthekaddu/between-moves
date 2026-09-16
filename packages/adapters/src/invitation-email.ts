import type {
  EmailMetrics,
  InvitationEmail,
  InvitationEmailDeliveryCodec,
  InvitationEmailSender,
  InvitationEmailSendResult,
} from '@between-moves/domain';
import { ResendEmailClient } from './resend-email-client';
import { AesGcmDeliveryCodec } from './sealed-delivery-codec';

function parseInvitationEmail(value: unknown): InvitationEmail {
  if (!value || typeof value !== 'object') throw new Error('Invalid sealed Invitation payload');
  const { email, invitationUrl } = value as Record<string, unknown>;
  if (typeof email !== 'string' || !email.includes('@') || typeof invitationUrl !== 'string') {
    throw new Error('Invalid sealed Invitation payload');
  }
  const url = new URL(invitationUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid sealed Invitation payload');
  }
  return { email, invitationUrl: url.toString() };
}

/** [BM-030] Keeps the Invitation token and intended email encrypted at rest in the outbox. */
export class AesGcmInvitationEmailDeliveryCodec implements InvitationEmailDeliveryCodec {
  private readonly codec: AesGcmDeliveryCodec<InvitationEmail>;

  constructor(secret: string) {
    this.codec = new AesGcmDeliveryCodec(secret, parseInvitationEmail);
  }

  seal(message: InvitationEmail): Promise<string> {
    return this.codec.seal(message);
  }

  open(sealed: string): Promise<InvitationEmail> {
    return this.codec.open(sealed);
  }
}

export interface ResendInvitationEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
}

/** [BM-030] Resend adapter for email-restricted House Invitations. */
export class ResendInvitationEmailSender implements InvitationEmailSender {
  private readonly client: ResendEmailClient;

  constructor(options: ResendInvitationEmailSenderOptions) {
    this.client = new ResendEmailClient(options);
  }

  async sendInvitation(
    message: InvitationEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<InvitationEmailSendResult> {
    await this.client.send(
      {
        to: message.email,
        subject: "You're invited to a House on Between Moves",
        text: `Use this link to join the House on Between Moves.\n\n${message.invitationUrl}`,
      },
      options.idempotencyKey,
    );
    return 'sent';
  }
}

export interface TestInvitationDelivery {
  readonly idempotencyKey: string;
  readonly message: InvitationEmail;
}

export class TestInvitationEmailSender implements InvitationEmailSender {
  private readonly sent = new Map<string, InvitationEmail>();

  async sendInvitation(
    message: InvitationEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<InvitationEmailSendResult> {
    if (this.sent.has(options.idempotencyKey)) return 'duplicate';
    this.sent.set(options.idempotencyKey, message);
    return 'sent';
  }

  deliveries(): readonly TestInvitationDelivery[] {
    return [...this.sent].map(([idempotencyKey, message]) => ({ idempotencyKey, message }));
  }
}
