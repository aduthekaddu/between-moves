import { describe, expect, it } from 'vitest';
import { createStructuredLogger } from './logger';

const sensitiveValues = [
  'session-secret',
  'invite-secret',
  'magic-secret',
  'realtime-secret',
  'private chat text',
  'private game note',
  'private email body',
  'member@example.com',
] as const;

describe('structured logger', () => {
  it('[BM-005] DR-SEC-06 emits the complete schema and redacts tokens, content, and email PII', () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      clock: { now: () => new Date('2026-08-29T00:00:00.000Z') },
      sink: (line) => lines.push(line),
    });

    logger.log({
      level: 'info',
      requestId: '01941f29-7c00-7000-8000-000000000001',
      actorId: 'anonymous',
      houseId: null,
      gameId: null,
      commandId: null,
      event: 'security.redaction-check',
      outcome: 'success',
      durationMs: 12,
      data: {
        sessionToken: sensitiveValues[0],
        invite_token: sensitiveValues[1],
        magicLinkToken: sensitiveValues[2],
        nested: { realtimeToken: sensitiveValues[3] },
        chatBody: sensitiveValues[4],
        game_note_body: sensitiveValues[5],
        emailContent: sensitiveValues[6],
        contact: sensitiveValues[7],
        safe: 'retained',
      },
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-08-29T00:00:00.000Z',
      level: 'info',
      request_id: '01941f29-7c00-7000-8000-000000000001',
      actor_id: 'anonymous',
      house_id: null,
      game_id: null,
      command_id: null,
      event: 'security.redaction-check',
      outcome: 'success',
      duration_ms: 12,
      data: {
        sessionToken: '[REDACTED]',
        invite_token: '[REDACTED]',
        magicLinkToken: '[REDACTED]',
        nested: { realtimeToken: '[REDACTED]' },
        chatBody: '[REDACTED]',
        game_note_body: '[REDACTED]',
        emailContent: '[REDACTED]',
        contact: '[REDACTED]',
        safe: 'retained',
      },
    });
    for (const sensitiveValue of sensitiveValues) expect(lines[0]).not.toContain(sensitiveValue);
  });
});
