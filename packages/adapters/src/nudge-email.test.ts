import type { NudgeEmail } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { ResendNudgeEmailSender, TestNudgeEmailSender } from './nudge-email';

const sentAt = new Date('2026-09-15T12:00:00.000Z');
const advance: NudgeEmail = {
  email: 'member@example.test',
  houseId: '01941f29-7c00-7000-8000-000000000601',
  houseName: 'Knights at Dusk',
  gameId: '01941f29-7c00-7000-8000-000000000101',
  ply: 7,
  stage: 'advance',
  opponentName: 'Bea',
  lastMoveSan: 'Nf3',
  moveDueAt: new Date('2026-09-16T11:00:00.000Z'),
};

function sentText(request: ReturnType<typeof vi.fn<typeof fetch>>): string {
  return String(JSON.parse(String(vi.mocked(request).mock.calls[0]?.[1]?.body)).text);
}

function resend(request: typeof fetch, appOrigin?: string) {
  return new ResendNudgeEmailSender({
    apiKey: 're_test_key',
    from: 'Between Moves <nudges@betweenmoves.app>',
    fetch: request,
    metrics: { incrementEmailSend: vi.fn() },
    appOrigin,
    now: () => sentAt,
  });
}

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
      expect(body.text).not.toContain(advance.gameId);
      expect(body.text).not.toContain('ply');
      expect(vi.mocked(request).mock.calls[0]?.[1]?.headers).toEqual(
        expect.objectContaining({ 'Idempotency-Key': 'nudge-event-1' }),
      );
    },
  );

  it('says who moved, what they played, how long is left, and links to the board', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'email_124' }), { status: 200 }),
    );
    await resend(request, 'https://between-moves.example').sendNudge(advance, {
      idempotencyKey: 'nudge-event-3',
    });
    expect(sentText(request)).toBe(
      [
        "Bea played Nf3. It's your move.",
        'You have about 23 hours to reply.',
        `Open the board: https://between-moves.example/h/${advance.houseId}/games/${advance.gameId}`,
      ].join('\n\n'),
    );
  });

  it('names the first Move and an overdue Move in plain words', async () => {
    const first = vi.fn<typeof fetch>(
      async () => new Response('{"id":"email_125"}', { status: 200 }),
    );
    await resend(first).sendNudge({ ...advance, lastMoveSan: null }, { idempotencyKey: 'a' });
    expect(sentText(first)).toBe(
      'Your game against Bea has started, and you move first.\n\nYou have about 23 hours to reply.',
    );
    const late = vi.fn<typeof fetch>(
      async () => new Response('{"id":"email_126"}', { status: 200 }),
    );
    await resend(late).sendNudge({ ...advance, stage: 'overdue' }, { idempotencyKey: 'b' });
    expect(sentText(late)).toBe(
      'Your move against Bea is past its deadline. The game is still waiting for you.',
    );
  });

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
