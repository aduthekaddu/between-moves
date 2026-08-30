import { describe, expect, it, vi } from 'vitest';
import { inspectInvitation } from './inspect-invitation';

describe('inspectInvitation', () => {
  it('[BM-014] [DR-INVITE-02] looks up a usable Invitation by digest without persisting the raw token', async () => {
    const inspect = vi.fn(async () => ({ houseName: 'Knights at Dusk' }));
    const result = await inspectInvitation(
      { token: 'raw-invitation-token' },
      {
        clock: { now: () => new Date('2026-08-30T11:00:00.000Z') },
        tokens: { digest: () => 'b'.repeat(64) },
        invitations: { inspect },
      },
    );

    expect(inspect).toHaveBeenCalledWith({
      tokenDigestHex: 'b'.repeat(64),
      inspectedAt: new Date('2026-08-30T11:00:00.000Z'),
    });
    expect(JSON.stringify(inspect.mock.calls)).not.toContain('raw-invitation-token');
    expect(result).toEqual({ houseName: 'Knights at Dusk' });
  });

  it('[BM-014] [DR-INVITE-02] rejects malformed tokens before storage lookup', async () => {
    const inspect = vi.fn();
    await expect(
      inspectInvitation(
        { token: 'malformed' },
        {
          clock: { now: () => new Date('2026-08-30T11:00:00.000Z') },
          tokens: { digest: () => null },
          invitations: { inspect },
        },
      ),
    ).resolves.toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });
});
