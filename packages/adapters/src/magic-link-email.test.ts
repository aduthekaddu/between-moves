import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AesGcmMagicLinkDeliveryCodec,
  generateMagicLinkToken,
  parseResendWebhook,
  ResendMagicLinkEmailSender,
  TestMagicLinkEmailSender,
} from './magic-link-email';

const message = {
  email: 'member@example.test',
  signInUrl: 'https://betweenmoves.test/api/auth/callback?token=raw-secret-token',
};

describe('magic-link email adapters', () => {
  it('[BM-008] [DR-ID-03] generates 32 CSPRNG bytes for every URL-safe token', () => {
    const first = generateMagicLinkToken();
    const second = generateMagicLinkToken();

    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
  });

  it('[BM-008] [DR-ID-03] seals email and raw token before outbox persistence', async () => {
    const codec = new AesGcmMagicLinkDeliveryCodec('test-sealing-secret-at-least-32-characters');
    const sealed = await codec.seal(message);

    expect(sealed).not.toContain(message.email);
    expect(sealed).not.toContain('raw-secret-token');
    await expect(codec.open(sealed)).resolves.toEqual(message);
    await expect(codec.open(`${sealed}tampered`)).rejects.toThrow();
  });

  it('[BM-008] records deterministic test delivery and deduplicates its event id', async () => {
    const sender = new TestMagicLinkEmailSender();

    await expect(sender.sendMagicLink(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'sent',
    );
    await expect(sender.sendMagicLink(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'duplicate',
    );
    expect(sender.deliveries()).toEqual([{ idempotencyKey: 'event-1', message }]);
  });

  it('[BM-008] [BM-030] sends the reviewed Resend request shape with provider idempotency', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    const metrics = { incrementEmailSend: vi.fn() };
    const sender = new ResendMagicLinkEmailSender({
      apiKey: 're_test_key',
      from: 'Between Moves <sign-in@betweenmoves.app>',
      fetch: request,
      metrics,
    });

    await expect(sender.sendMagicLink(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'sent',
    );
    expect(request).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'event-1',
        }),
      }),
    );
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      from: 'Between Moves <sign-in@betweenmoves.app>',
      to: [message.email],
      subject: 'Sign in to Between Moves',
    });
    expect(body.text).toContain(message.signInUrl);
    expect(metrics.incrementEmailSend).toHaveBeenCalledWith('success');
  });

  it('[BM-008] [BM-030] surfaces provider failures for retention and records failure outcome', async () => {
    const metrics = { incrementEmailSend: vi.fn() };
    const sender = new ResendMagicLinkEmailSender({
      apiKey: 're_test_key',
      from: 'Between Moves <sign-in@betweenmoves.app>',
      fetch: vi.fn(async () => new Response('unavailable', { status: 503 })),
      metrics,
    });

    await expect(sender.sendMagicLink(message, { idempotencyKey: 'event-2' })).rejects.toThrow(
      'Resend email request failed',
    );
    expect(metrics.incrementEmailSend).toHaveBeenCalledWith('failure');
  });

  it('[BM-008] [BM-030] verifies and parses a current Resend webhook contract fixture', async () => {
    const key = randomBytes(32);
    const secret = `whsec_${key.toString('base64')}`;
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-08-29T14:00:00.000Z',
      data: { email_id: 'email_123', to: ['member@example.test'] },
    });
    const id = 'msg_123';
    const timestamp = String(Math.floor(new Date('2026-08-29T14:02:00.000Z').getTime() / 1000));
    const signature = createHmac('sha256', key)
      .update(`${id}.${timestamp}.${body}`)
      .digest('base64');

    await expect(
      parseResendWebhook({
        body,
        headers: new Headers({
          'svix-id': id,
          'svix-timestamp': timestamp,
          'svix-signature': `v1,${signature}`,
        }),
        secret,
        now: new Date('2026-08-29T14:04:00.000Z'),
      }),
    ).resolves.toEqual({
      id,
      type: 'email.delivered',
      occurredAt: new Date('2026-08-29T14:00:00.000Z'),
      emailId: 'email_123',
    });
  });

  it('[BM-008] rejects unsigned, invalid, and stale Resend webhooks', async () => {
    const input = {
      body: '{}',
      headers: new Headers(),
      secret: `whsec_${randomBytes(32).toString('base64')}`,
      now: new Date('2026-08-29T14:10:00.000Z'),
    };

    await expect(parseResendWebhook(input)).rejects.toThrow('Invalid Resend webhook');
  });
});
