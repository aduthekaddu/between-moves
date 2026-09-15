import type { NudgeEmail, NudgeEmailSender, NudgeEmailSendResult } from '@between-moves/domain';

export interface ResendNudgeEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
}

function subject(message: NudgeEmail): string {
  return message.stage === 'advance'
    ? `It's your move in ${message.houseName}`
    : `Still your move in ${message.houseName}`;
}

function body(message: NudgeEmail): string {
  const timing = message.stage === 'advance' ? 'is approaching' : 'has passed';
  return `Your move deadline ${timing} for Game ${message.gameId} at ply ${message.ply}.`;
}

/** [BM-029] [PR-COPY-10/11] Fixed-origin Resend Nudge adapter; content is never logged. */
export class ResendNudgeEmailSender implements NudgeEmailSender {
  private readonly request: typeof fetch;

  constructor(private readonly options: ResendNudgeEmailSenderOptions) {
    this.request = options.fetch ?? globalThis.fetch;
  }

  async sendNudge(
    message: NudgeEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult> {
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
          subject: subject(message),
          text: body(message),
        }),
      });
      if (!response.ok) throw new Error(`Resend Nudge email request failed (${response.status})`);
      return 'sent';
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Resend Nudge email request failed')) {
        throw error;
      }
      throw new Error('Resend Nudge email request failed', { cause: error });
    }
  }
}

export interface TestNudgeDelivery {
  readonly idempotencyKey: string;
  readonly message: NudgeEmail;
}

/** Offline, provider-idempotent Nudge sender for deterministic delivery tests. */
export class TestNudgeEmailSender implements NudgeEmailSender {
  private readonly sent = new Map<string, NudgeEmail>();

  async sendNudge(
    message: NudgeEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult> {
    if (this.sent.has(options.idempotencyKey)) return 'duplicate';
    this.sent.set(options.idempotencyKey, message);
    return 'sent';
  }

  deliveries(): readonly TestNudgeDelivery[] {
    return [...this.sent].map(([idempotencyKey, message]) => ({ idempotencyKey, message }));
  }
}
