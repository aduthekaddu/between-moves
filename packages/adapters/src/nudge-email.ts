import type {
  EmailMetrics,
  NudgeEmail,
  NudgeEmailSender,
  NudgeEmailSendResult,
} from '@between-moves/domain';
import { ResendEmailClient } from './resend-email-client';

export interface ResendNudgeEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
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
  private readonly client: ResendEmailClient;

  constructor(private readonly options: ResendNudgeEmailSenderOptions) {
    this.client = new ResendEmailClient(options);
  }

  async sendNudge(
    message: NudgeEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult> {
    await this.client.send(
      { to: message.email, subject: subject(message), text: body(message) },
      options.idempotencyKey,
    );
    return 'sent';
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
