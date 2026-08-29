import type {
  MagicLinkEmail,
  MagicLinkEmailSender,
  MagicLinkEmailSendResult,
} from '@between-moves/domain';

interface EmailMetrics {
  incrementEmailSend(outcome: 'success' | 'failure'): void;
}

export interface ResendMagicLinkEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
}

/** [BM-008] Fixed-origin Resend adapter; request bodies are never logged. */
export class ResendMagicLinkEmailSender implements MagicLinkEmailSender {
  private readonly request: typeof fetch;

  constructor(private readonly options: ResendMagicLinkEmailSenderOptions) {
    this.request = options.fetch ?? globalThis.fetch;
  }

  async sendMagicLink(
    message: MagicLinkEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<MagicLinkEmailSendResult> {
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': options.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.email],
          subject: 'Sign in to Between Moves',
          text: `Use this link to sign in to Between Moves. It expires in 15 minutes.\n\n${message.signInUrl}`,
        }),
      });
      if (!response.ok) throw new Error(`Resend email request failed (${response.status})`);
      this.options.metrics.incrementEmailSend('success');
      return 'sent';
    } catch (error) {
      this.options.metrics.incrementEmailSend('failure');
      if (error instanceof Error && error.message.startsWith('Resend email request failed')) {
        throw error;
      }
      throw new Error('Resend email request failed', { cause: error });
    }
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
