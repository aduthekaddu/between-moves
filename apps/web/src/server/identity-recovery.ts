import { SystemClock } from '@between-moves/adapters';
import {
  createCompleteAccountRecovery,
  createDiscardRecoveredSession,
  createRequestAccountRecovery,
} from '@between-moves/application';
import { PgIdentityRecoveryRepository } from '@between-moves/db';
import { getAuth } from './auth';
import { getDatabase } from './database';

const globalRecovery = globalThis as typeof globalThis & {
  betweenMovesRecoveryRepository?: PgIdentityRecoveryRepository;
};

export function getIdentityRecoveryRepository(): PgIdentityRecoveryRepository {
  globalRecovery.betweenMovesRecoveryRepository ??= new PgIdentityRecoveryRepository(
    getDatabase().pool,
  );
  return globalRecovery.betweenMovesRecoveryRepository;
}

/** [BM-010] Request a recovery-only magic link for an existing active account. */
export function requestAccountRecovery(email: string, headers: Headers): Promise<void> {
  return createRequestAccountRecovery({
    accounts: getIdentityRecoveryRepository(),
    async sendRecoveryLink(existingEmail) {
      await getAuth().api.signInMagicLink({
        body: {
          email: existingEmail,
          name: 'Member',
          callbackURL: '/',
          metadata: { flow: 'recovery' },
        },
        headers,
      });
    },
  })(email);
}

/** [BM-010] Soft-revoke all sessions except the newly verified recovery session. */
export function completeAccountRecovery(currentSessionToken: string) {
  return createCompleteAccountRecovery({
    clock: new SystemClock(),
    sessions: getIdentityRecoveryRepository(),
  })(currentSessionToken);
}

/** [BM-010] Fail closed by soft-revoking an unpublished recovery session. */
export function discardRecoveredSession(sessionToken: string): Promise<void> {
  return createDiscardRecoveredSession({
    clock: new SystemClock(),
    sessions: getIdentityRecoveryRepository(),
  })(sessionToken);
}
