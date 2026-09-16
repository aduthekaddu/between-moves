import { RetriableOutboxError, type EmailMetrics } from '@between-moves/domain';

export interface ResendEmailClientOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
}

export interface ResendEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** [BM-030] Fixed-origin Resend request seam; bodies and addresses are never logged. */
export class ResendEmailClient {
  private readonly request: typeof fetch;

  constructor(private readonly options: ResendEmailClientOptions) {
    this.request = options.fetch ?? globalThis.fetch;
  }

  async send(message: ResendEmailMessage, idempotencyKey: string): Promise<void> {
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) {
        throw new RetriableOutboxError(`Resend email request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      const providerId =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>).id : null;
      if (typeof providerId !== 'string' || providerId.length === 0 || providerId.length > 256) {
        throw new RetriableOutboxError('Invalid Resend email response');
      }
      this.options.metrics.incrementEmailSend('success');
    } catch (error) {
      this.options.metrics.incrementEmailSend('failure');
      if (error instanceof RetriableOutboxError) throw error;
      throw new RetriableOutboxError('Resend email request failed', { cause: error });
    }
  }
}
