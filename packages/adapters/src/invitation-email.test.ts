import { describe, expect, it, vi } from 'vitest';
import {
  AesGcmInvitationEmailDeliveryCodec,
  ResendInvitationEmailSender,
  TestInvitationEmailSender,
} from './invitation-email';

const message = {
  email: 'friend@example.test',
  invitationUrl: 'https://betweenmoves.test/invitations/raw-secret-token',
};

describe('Invitation email adapters', () => {
  it('[BM-030] encrypts recipient and token before outbox persistence', async () => {
    const codec = new AesGcmInvitationEmailDeliveryCodec(
      'test-sealing-secret-at-least-32-characters',
    );
    const sealed = await codec.seal(message);

    expect(sealed).not.toContain(message.email);
    expect(sealed).not.toContain('raw-secret-token');
    await expect(codec.open(sealed)).resolves.toEqual(message);
  });

  it('[BM-030] sends the Resend contract with event-id idempotency and metrics', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    const metrics = { incrementEmailSend: vi.fn() };
    const sender = new ResendInvitationEmailSender({
      apiKey: 're_test_key',
      from: 'Between Moves <invitations@betweenmoves.app>',
      fetch: request,
      metrics,
    });

    await expect(sender.sendInvitation(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'sent',
    );
    const init = vi.mocked(request).mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(init?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': 'event-1' }));
    expect(body).toMatchObject({
      from: 'Between Moves <invitations@betweenmoves.app>',
      to: [message.email],
      subject: "You're invited to a House on Between Moves",
    });
    expect(body.text).toContain(message.invitationUrl);
    expect(metrics.incrementEmailSend).toHaveBeenCalledWith('success');
  });

  it('[BM-030] test transport sends once per outbox event ID', async () => {
    const sender = new TestInvitationEmailSender();

    await expect(sender.sendInvitation(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'sent',
    );
    await expect(sender.sendInvitation(message, { idempotencyKey: 'event-1' })).resolves.toBe(
      'duplicate',
    );
    expect(sender.deliveries()).toEqual([{ idempotencyKey: 'event-1', message }]);
  });

  it('[BM-030] treats a malformed successful provider response as a retained failure', async () => {
    const metrics = { incrementEmailSend: vi.fn() };
    const sender = new ResendInvitationEmailSender({
      apiKey: 're_test_key',
      from: 'Between Moves <invitations@betweenmoves.app>',
      fetch: vi.fn(async () => new Response('{}', { status: 200 })),
      metrics,
    });

    await expect(sender.sendInvitation(message, { idempotencyKey: 'event-2' })).rejects.toThrow(
      'Invalid Resend email response',
    );
    expect(metrics.incrementEmailSend).toHaveBeenCalledWith('failure');
  });
});
