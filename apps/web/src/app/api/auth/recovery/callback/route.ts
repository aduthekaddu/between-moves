import { getAuth } from '../../../../../server/auth';
import {
  completeAccountRecovery,
  discardRecoveredSession,
} from '../../../../../server/identity-recovery';
import { getLogger } from '../../../../../server/logger';
import { verifyMagicLinkPurpose } from '../../../../../server/magic-link-purpose';
import { getConfig } from '../../../../../config';
import { createRecoveryCallbackHandler } from './handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VerificationPayload {
  readonly token?: unknown;
}

export function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? 'request-unavailable';
  const logger = getLogger();
  return createRecoveryCallbackHandler({
    isExpectedPurpose(token, proof) {
      return verifyMagicLinkPurpose(getConfig().betterAuthSecret, 'recovery', token, proof);
    },
    async verifyMagicLink(token, headers) {
      const response = await getAuth().api.magicLinkVerify({
        query: { token, errorCallbackURL: '/auth/link-invalid' },
        headers,
        asResponse: true,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as VerificationPayload;
      if (typeof payload.token !== 'string') return null;
      const cookies = response.headers.getSetCookie();
      return { sessionToken: payload.token, cookies };
    },
    completeRecovery: completeAccountRecovery,
    discardRecoverySession: discardRecoveredSession,
    onCompleted(result) {
      const common = {
        level: 'info' as const,
        requestId,
        actorId: result.userId,
        houseId: null,
        gameId: null,
        commandId: null,
        outcome: 'success' as const,
        durationMs: 0,
      };
      logger.log({ ...common, event: 'identity.recovery.completed' });
      logger.log({
        ...common,
        event: 'identity.sessions.revoked',
        data: { revokedSessionCount: result.revokedSessionCount },
      });
    },
    onFailed() {
      logger.log({
        level: 'warn',
        requestId,
        actorId: 'anonymous',
        houseId: null,
        gameId: null,
        commandId: null,
        event: 'identity.recovery.failed',
        outcome: 'rejected',
        durationMs: 0,
      });
    },
  })(request);
}
