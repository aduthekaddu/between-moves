import type {
  EmailMetrics,
  NudgeEmail,
  NudgeEmailSender,
  NudgeEmailSendResult,
  VerifiedNudgeDelivery,
} from '@between-moves/domain';
import { ResendEmailClient } from './resend-email-client';

export interface ResendNudgeEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly metrics: EmailMetrics;
  /** The web origin; with it, the email links straight to the board. */
  readonly appOrigin?: string | undefined;
  readonly now?: () => Date;
}

function subject(message: NudgeEmail): string {
  return message.stage === 'advance'
    ? `It's your move in ${message.houseName}`
    : `Still your move in ${message.houseName}`;
}

function timeLeft(due: Date, now: Date): string | null {
  const hours = Math.round((due.getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return null;
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}

/** Plain words a person acts on: who moved, what they played, how long is left, where to go. */
function body(message: NudgeEmail, appOrigin: string | undefined, now: Date): string {
  const lines: string[] = [];
  if (message.stage === 'advance') {
    lines.push(
      message.lastMoveSan === null
        ? `Your game against ${message.opponentName} has started, and you move first.`
        : `${message.opponentName} played ${message.lastMoveSan}. It's your move.`,
    );
    const left = message.moveDueAt === null ? null : timeLeft(message.moveDueAt, now);
    if (left !== null) lines.push(`You have ${left} to reply.`);
  } else {
    lines.push(
      `Your move against ${message.opponentName} is past its deadline. The game is still waiting for you.`,
    );
  }
  if (appOrigin !== undefined) {
    const board = new URL(
      `/h/${encodeURIComponent(message.houseId)}/games/${encodeURIComponent(message.gameId)}`,
      appOrigin,
    );
    lines.push(`Open the board: ${board.toString()}`);
  }
  return lines.join('\n\n');
}

/** [BM-029] [PR-COPY-10/11] Fixed-origin Resend Nudge adapter; content is never logged. */
export class ResendNudgeEmailSender implements NudgeEmailSender {
  private readonly client: ResendEmailClient;

  constructor(private readonly options: ResendNudgeEmailSenderOptions) {
    this.client = new ResendEmailClient(options);
  }

  async sendNudge(
    delivery: VerifiedNudgeDelivery,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult> {
    const now = this.options.now?.() ?? new Date();
    await this.client.send(
      {
        to: delivery.email,
        subject: subject(delivery),
        text: body(delivery, this.options.appOrigin, now),
      },
      options.idempotencyKey,
    );
    return 'sent';
  }
}

export interface TestNudgeDelivery {
  readonly idempotencyKey: string;
  readonly message: VerifiedNudgeDelivery;
}

/** Offline, provider-idempotent Nudge sender for deterministic delivery tests. */
export class TestNudgeEmailSender implements NudgeEmailSender {
  private readonly sent = new Map<string, VerifiedNudgeDelivery>();

  async sendNudge(
    delivery: VerifiedNudgeDelivery,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult> {
    if (this.sent.has(options.idempotencyKey)) return 'duplicate';
    this.sent.set(options.idempotencyKey, delivery);
    return 'sent';
  }

  deliveries(): readonly TestNudgeDelivery[] {
    return [...this.sent].map(([idempotencyKey, message]) => ({ idempotencyKey, message }));
  }
}
