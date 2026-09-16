import type { EmailDeliveryEventRecordResult, ResendDeliveryEvent } from '@between-moves/domain';
import { problemResponse } from '../../../../kernel/request';

const MAXIMUM_BODY_BYTES = 64 * 1_024;

export interface ResendWebhookHandlerDependencies {
  readonly secret: string;
  readonly clock: { now(): Date };
  readonly verify: (input: {
    readonly body: string;
    readonly headers: Headers;
    readonly secret: string;
    readonly now: Date;
  }) => Promise<ResendDeliveryEvent>;
  readonly record: (event: ResendDeliveryEvent) => Promise<EmailDeliveryEventRecordResult>;
}

async function rawBody(request: Request): Promise<string | null> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAXIMUM_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** [BM-030] Security §6.5 verifies raw Resend input before durable processing. */
export function createResendWebhookHandler(dependencies: ResendWebhookHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const body = await rawBody(request);
    if (body === null) {
      return problemResponse(
        request,
        403,
        'origin_rejected',
        'Webhook rejected',
        'Webhook verification failed.',
      );
    }
    let event: ResendDeliveryEvent;
    try {
      event = await dependencies.verify({
        body,
        headers: request.headers,
        secret: dependencies.secret,
        now: dependencies.clock.now(),
      });
    } catch {
      return problemResponse(
        request,
        403,
        'origin_rejected',
        'Webhook rejected',
        'Webhook verification failed.',
      );
    }
    await dependencies.record(event);
    return new Response(null, { status: 204 });
  };
}
