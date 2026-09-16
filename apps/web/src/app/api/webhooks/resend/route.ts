import { parseResendWebhook, SystemClock } from '@between-moves/adapters';
import { getConfig } from '../../../../config';
import { recordEmailDeliveryEvent } from '../../../../server/email-delivery';
import { createResendWebhookHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return createResendWebhookHandler({
    secret: getConfig().resendWebhookSecret,
    clock: new SystemClock(),
    verify: parseResendWebhook,
    record: recordEmailDeliveryEvent,
  })(request);
}
