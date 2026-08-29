import type {
  AccountRecoveryReader,
  AccountRecoveryResult,
  Clock,
  RecoverySessionCleaner,
  RecoverySessionRepository,
} from '@between-moves/domain';

export interface RequestAccountRecoveryDependencies {
  readonly accounts: AccountRecoveryReader;
  readonly sendRecoveryLink: (email: string) => Promise<void>;
}

/** [BM-010] [DR-ID-02] Unknown accounts complete without sending, preserving non-disclosure. */
export function createRequestAccountRecovery(
  dependencies: RequestAccountRecoveryDependencies,
): (email: string) => Promise<void> {
  return async (email) => {
    if (await dependencies.accounts.hasActiveAccount(email)) {
      await dependencies.sendRecoveryLink(email);
    }
  };
}

export interface CompleteAccountRecoveryDependencies {
  readonly clock: Clock;
  readonly sessions: RecoverySessionRepository;
}

/** [BM-010] [DR-ID-02] Makes the recovered session the only active session for its account. */
export function createCompleteAccountRecovery(
  dependencies: CompleteAccountRecoveryDependencies,
): (currentSessionToken: string) => Promise<AccountRecoveryResult> {
  return async (currentSessionToken) => {
    const result = await dependencies.sessions.revokePriorSessions(
      currentSessionToken,
      dependencies.clock.now(),
    );
    if (!result) throw new Error('Recovered session was not found');
    return result;
  };
}

export interface DiscardRecoveredSessionDependencies {
  readonly clock: Clock;
  readonly sessions: RecoverySessionCleaner;
}

/** [BM-010] Fail closed when a provider session exists but recovery cannot complete. */
export function createDiscardRecoveredSession(
  dependencies: DiscardRecoveredSessionDependencies,
): (sessionToken: string) => Promise<void> {
  return (sessionToken) =>
    dependencies.sessions.revokeSession(sessionToken, dependencies.clock.now());
}
