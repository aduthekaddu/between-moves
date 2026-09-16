import { parseResendWebhook } from '@between-moves/adapters';
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createResendWebhookHandler } from './handler';

const NOW = new Date('2026-09-16T10:02:00.000Z');

function signedRequest(input: { body: string; secret: string; signedAt: Date; id?: string }) {
  const id = input.id ?? 'msg_123';
  const timestamp = String(Math.floor(input.signedAt.getTime() / 1_000));
  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${input.body}`)
    .digest('base64');
  return new Request('https://betweenmoves.test/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body: input.body,
  });
}

describe('Resend webhook handler', () => {
  it('[BM-030] verifies the raw contract and applies a duplicate provider event once', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-09-16T10:01:00.000Z',
      data: { email_id: 'email_123', to: ['private@example.test'] },
    });
    const seen = new Set<string>();
    let effects = 0;
    const handler = createResendWebhookHandler({
      secret,
      clock: { now: () => NOW },
      verify: parseResendWebhook,
      record: async (event) => {
        if (seen.has(event.id)) return 'duplicate';
        seen.add(event.id);
        effects += 1;
        return 'processed';
      },
    });

    await expect(handler(signedRequest({ body, secret, signedAt: NOW }))).resolves.toMatchObject({
      status: 204,
    });
    await expect(handler(signedRequest({ body, secret, signedAt: NOW }))).resolves.toMatchObject({
      status: 204,
    });
    expect(effects).toBe(1);
  });

  it('[BM-030] rejects a validly signed timestamp outside the five-minute replay window', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const body = JSON.stringify({
      type: 'email.failed',
      created_at: '2026-09-16T09:50:00.000Z',
      data: { email_id: 'email_456' },
    });
    const handler = createResendWebhookHandler({
      secret,
      clock: { now: () => NOW },
      verify: parseResendWebhook,
      record: async () => 'processed',
    });

    const response = await handler(
      signedRequest({ body, secret, signedAt: new Date('2026-09-16T09:56:59.000Z') }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'origin_rejected' });
  });

  it('[BM-030] rejects future timestamps and raw-body mutation', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const body = JSON.stringify({
      type: 'email.sent',
      created_at: NOW.toISOString(),
      data: { email_id: 'email_789' },
    });
    const record = async () => 'processed' as const;
    const handler = createResendWebhookHandler({
      secret,
      clock: { now: () => NOW },
      verify: parseResendWebhook,
      record,
    });

    const future = await handler(
      signedRequest({
        body,
        secret,
        signedAt: new Date(NOW.getTime() + 5 * 60_000 + 1_000),
      }),
    );
    expect(future.status).toBe(403);

    const signed = signedRequest({ body, secret, signedAt: NOW });
    const mutated = new Request(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: body.replace('email_789', 'email_tampered'),
    });
    await expect(handler(mutated)).resolves.toMatchObject({ status: 403 });
  });

  it('[BM-030] rejects oversized input before verification', async () => {
    let verified = false;
    const handler = createResendWebhookHandler({
      secret: 'unused',
      clock: { now: () => NOW },
      verify: async () => {
        verified = true;
        throw new Error('must not verify oversized input');
      },
      record: async () => 'processed',
    });

    const response = await handler(
      new Request('https://betweenmoves.test/api/webhooks/resend', {
        method: 'POST',
        body: 'x'.repeat(64 * 1_024 + 1),
      }),
    );
    expect(response.status).toBe(403);
    expect(verified).toBe(false);
  });

  it('[BM-030] lets persistence failure return a retriable server failure', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: NOW.toISOString(),
      data: { email_id: 'email_retry' },
    });
    const handler = createResendWebhookHandler({
      secret,
      clock: { now: () => NOW },
      verify: parseResendWebhook,
      record: async () => {
        throw new Error('database unavailable');
      },
    });

    await expect(handler(signedRequest({ body, secret, signedAt: NOW }))).rejects.toThrow(
      'database unavailable',
    );
  });
});
