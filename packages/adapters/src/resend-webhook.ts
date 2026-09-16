import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ResendDeliveryEvent, ResendDeliveryEventType } from '@between-moves/domain';

const REPLAY_WINDOW_SECONDS = 5 * 60;
const EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.complained',
  'email.bounced',
  'email.opened',
  'email.clicked',
  'email.failed',
  'email.scheduled',
  'email.suppressed',
] satisfies readonly ResendDeliveryEventType[]);

export type ResendWebhookEvent = ResendDeliveryEvent;

export interface ResendWebhookInput {
  readonly body: string;
  readonly headers: Headers;
  readonly secret: string;
  readonly now: Date;
}

function invalid(): Error {
  return new Error('Invalid Resend webhook');
}

function signingKey(secret: string): Buffer {
  if (!secret.startsWith('whsec_')) throw invalid();
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) throw invalid();
  return key;
}

function signatureMatches(signatures: string, expected: Buffer): boolean {
  return signatures.split(' ').some((entry) => {
    const [version, encoded] = entry.split(',');
    if (version !== 'v1' || !encoded) return false;
    const candidate = Buffer.from(encoded, 'base64');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

function parsePayload(body: string, id: string): ResendWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalid();
  }
  if (!value || typeof value !== 'object') throw invalid();
  const event = value as Record<string, unknown>;
  const data = event.data;
  const occurredAt = new Date(String(event.created_at));
  if (
    typeof event.type !== 'string' ||
    !EVENT_TYPES.has(event.type as ResendDeliveryEventType) ||
    !Number.isFinite(occurredAt.getTime()) ||
    !data ||
    typeof data !== 'object' ||
    typeof (data as Record<string, unknown>).email_id !== 'string' ||
    id.length === 0 ||
    id.length > 256 ||
    (data as { email_id: string }).email_id.length === 0 ||
    (data as { email_id: string }).email_id.length > 256
  ) {
    throw invalid();
  }
  return {
    id,
    type: event.type as ResendDeliveryEventType,
    occurredAt,
    emailId: (data as { email_id: string }).email_id,
  };
}

/** [BM-008] Security §6.5 verifies Resend before parsing provider-controlled JSON. */
export async function parseResendWebhook(input: ResendWebhookInput): Promise<ResendWebhookEvent> {
  const id = input.headers.get('svix-id');
  const timestampText = input.headers.get('svix-timestamp');
  const signatures = input.headers.get('svix-signature');
  const timestamp = Number(timestampText);
  if (!id || !timestampText || !signatures || !Number.isInteger(timestamp)) throw invalid();
  const age = Math.abs(input.now.getTime() / 1000 - timestamp);
  if (age > REPLAY_WINDOW_SECONDS) throw invalid();
  const expected = createHmac('sha256', signingKey(input.secret))
    .update(`${id}.${timestampText}.${input.body}`)
    .digest();
  if (!signatureMatches(signatures, expected)) throw invalid();
  return parsePayload(input.body, id);
}
