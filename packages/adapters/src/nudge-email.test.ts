import type { NudgeEmail } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { ResendNudgeEmailSender, TestNudgeEmailSender } from './nudge-email';

const advance: NudgeEmail = {
  email: 'member@example.test',
  houseName: 'Knights at Dusk',
  gameId: '01941f29-7c00-7000-8000-000000000101',
  ply: 7,
  stage: 'advance',
};

describe('Nudge email adapters', () => {
  it.each([
    ['advance', "It's your move in Knights at Dusk"],
    ['overdue', 'Still your move in Knights at Dusk'],
  ] as const)(
    '[BM-029] [PR-COPY-10/11] sends the %s subject with provider idempotency',
    async (stage, subject) => {
      const request = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
      );
      const sender = new ResendNudgeEmailSender({
        apiKey: 're_test_key',
        from: 'Between Moves <nudges@betweenmoves.app>',
        fetch: request,
        metrics: { incrementEmailSend: vi.fn() },
      });

      await expect(
        sender.sendNudge({ ...advance, stage }, { idempotencyKey: 'nudge-event-1' }),
      ).resolves.toBe('sent');
      const body = JSON.parse(String(vi.mocked(request).mock.calls[0]?.[1]?.body));
      expect(body).toMatchObject({
        from: 'Between Moves <nudges@betweenmoves.app>',
        to: [advance.email],
        subject,
      });
      expect(body.text).toContain(advance.gameId);
      expect(body.text).toContain('ply 7');
      expect(vi.mocked(request).mock.calls[0]?.[1]?.headers).toEqual(
        expect.objectContaining({ 'Idempotency-Key': 'nudge-event-1' }),
      );
    },
  );

  it('[BM-029] [DR-DELIV-03] surfaces provider failure for durable outbox retry', async () => {
    const sender = new ResendNudgeEmailSender({
      apiKey: 're_test_key',
      from: 'Between Moves <nudges@betweenmoves.app>',
      fetch: vi.fn(async () => new Response('unavailable', { status: 503 })),
      metrics: { incrementEmailSend: vi.fn() },
    });

    await expect(sender.sendNudge(advance, { idempotencyKey: 'nudge-event-2' })).rejects.toThrow(
      'Resend email request failed',
    );
  });

  it('[BM-029] [DR-CORR-04] test sender applies one effect per event ID', async () => {
    const sender = new TestNudgeEmailSender();

    await expect(sender.sendNudge(advance, { idempotencyKey: 'event-1' })).resolves.toBe('sent');
    await expect(sender.sendNudge(advance, { idempotencyKey: 'event-1' })).resolves.toBe(
      'duplicate',
    );
    expect(sender.deliveries()).toEqual([{ idempotencyKey: 'event-1', message: advance }]);
  });
});
