import type {
  EmailMetrics,
  MagicLinkEmail,
  MagicLinkEmailSender,
  MagicLinkEmailSendResult,
} from '@between-moves/domain';
import { ResendEmailClient } from './resend-email-client';

export interface ResendMagicLinkEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
}

/** [BM-008] Fixed-origin Resend adapter; request bodies are never logged. */
export class ResendMagicLinkEmailSender implements MagicLinkEmailSender {
  private readonly client: ResendEmailClient;

  constructor(private readonly options: ResendMagicLinkEmailSenderOptions) {
    this.client = new ResendEmailClient(options);
  }

  async sendMagicLink(
    message: MagicLinkEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<MagicLinkEmailSendResult> {
    await this.client.send(
      {
        to: message.email,
        subject: 'Sign in to Between Moves',
        text: `Use this link to sign in to Between Moves. It expires in 15 minutes.\n\n${message.signInUrl}`,
      },
      options.idempotencyKey,
    );
    return 'sent';
  }
}

export interface TestMagicLinkDelivery {
  readonly idempotencyKey: string;
  readonly message: MagicLinkEmail;
}

/** [BM-008] Offline transport for deterministic full-flow tests. */
export class TestMagicLinkEmailSender implements MagicLinkEmailSender {
  private readonly sent = new Map<string, MagicLinkEmail>();

  async sendMagicLink(
    message: MagicLinkEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<MagicLinkEmailSendResult> {
    if (this.sent.has(options.idempotencyKey)) return 'duplicate';
    this.sent.set(options.idempotencyKey, message);
    return 'sent';
  }

  deliveries(): readonly TestMagicLinkDelivery[] {
    return [...this.sent].map(([idempotencyKey, message]) => ({ idempotencyKey, message }));
  }
}
