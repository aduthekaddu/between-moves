import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  createCompleteAccountRecovery,
  createDiscardRecoveredSession,
  createRequestAccountRecovery,
} from './recovery';

describe('account recovery', () => {
  it('[BM-010] [DR-ID-02] sends a recovery link only for an active account', async () => {
    const accounts = {
      hasActiveAccount: vi.fn(async (email: string) => email.startsWith('known')),
    };
    const sendRecoveryLink = vi.fn(async () => undefined);
    const requestRecovery = createRequestAccountRecovery({ accounts, sendRecoveryLink });

    await requestRecovery('known@example.test');
    await requestRecovery('unknown@example.test');

    expect(accounts.hasActiveAccount).toHaveBeenCalledTimes(2);
    expect(sendRecoveryLink).toHaveBeenCalledOnce();
    expect(sendRecoveryLink).toHaveBeenCalledWith('known@example.test');
  });

  it('[BM-010] [DR-ID-02] revokes every prior session at the injected recovery time', async () => {
    const revokedAt = new Date('2026-08-29T18:00:00.000Z');
    const sessions = {
      revokePriorSessions: vi.fn(async () => ({
        userId: '01941f29-7c00-7000-8000-000000000001',
        revokedSessionCount: 2,
      })),
    };
    const completeRecovery = createCompleteAccountRecovery({
      clock: new FakeClock(revokedAt),
      sessions,
    });

    await expect(completeRecovery('new-recovered-session-token')).resolves.toEqual({
      userId: '01941f29-7c00-7000-8000-000000000001',
      revokedSessionCount: 2,
    });
    expect(sessions.revokePriorSessions).toHaveBeenCalledWith(
      'new-recovered-session-token',
      revokedAt,
    );
  });

  it('[BM-010] discards a newly minted session when recovery completion fails', async () => {
    const revokedAt = new Date('2026-08-29T18:01:00.000Z');
    const sessions = { revokeSession: vi.fn(async () => undefined) };
    const discardRecoveredSession = createDiscardRecoveredSession({
      clock: new FakeClock(revokedAt),
      sessions,
    });

    await discardRecoveredSession('unpublished-session-token');

    expect(sessions.revokeSession).toHaveBeenCalledWith('unpublished-session-token', revokedAt);
  });

  it('[BM-010] rejects completion when the recovered session cannot be found', async () => {
    const completeRecovery = createCompleteAccountRecovery({
      clock: new FakeClock(new Date('2026-08-29T18:00:00.000Z')),
      sessions: { revokePriorSessions: vi.fn(async () => null) },
    });

    await expect(completeRecovery('missing-session-token')).rejects.toThrow(
      'Recovered session was not found',
    );
  });
});
