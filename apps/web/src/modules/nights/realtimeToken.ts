import { HmacRealtimeTokenIssuer, SystemClock } from '@between-moves/adapters';
import { createAuthorizeHouseAction, mintRealtimeToken } from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgNightRealtimeScopeRepository,
} from '@between-moves/db';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import type { NightRealtimeTokenHandlerDependencies } from '../../server/night-realtime-token-handler';
import { getRealtimeMetrics, getRealtimeTokenRateLimit } from '../../server/rate-limit';
import { requireViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function requestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

/** [BM-037] Web composition for Night-scoped realtime token minting. */
export function nightRealtimeTokenHandlerDependencies(
  request: Request,
): NightRealtimeTokenHandlerDependencies {
  const config = getConfig();
  const database = getDatabase().pool;
  const id = requestId(request);
  const tokens = new HmacRealtimeTokenIssuer({
    appId: config.realtimeAppId,
    serverKey: config.realtimeServerKey,
    publicKey: config.realtimePublicKey,
  });
  return {
    expectedOrigin: config.appOrigin.origin,
    realtimeServerKey: config.realtimeServerKey,
    requireViewer,
    limitRealtimeToken: getRealtimeTokenRateLimit(),
    mintRealtimeToken: (command) =>
      mintRealtimeToken(command, {
        authorizeHouseAction: createAuthorizeHouseAction({
          memberships: new PgHouseAuthorizationMembershipRepository(database),
          nightHosts: { isAssignedNightHost: async () => false },
          denials: createHouseAuthorizationDenialRecorder({
            logger: getLogger(),
            metrics: authorizationMetrics,
            requestId: id,
          }),
        }),
        clock,
        nights: new PgNightRealtimeScopeRepository(database),
        tokens,
      }),
    logger: getLogger(),
    metrics: getRealtimeMetrics(),
    clock,
  };
}
