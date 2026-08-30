import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  changeMembershipRole,
  createAuthorizeHouseAction,
  leaveHouse,
  removeHouseMember,
  transferHouseOwnership,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgMembershipAdminRepository,
} from '@between-moves/db';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getConfig } from '../config';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import type { MembershipAdminHandlerDependencies } from './membership-admin-handler';
import { getDatabase } from './database';
import { getLogger } from './logger';
import { requireViewer } from './viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function commandDependencies(requestId: string) {
  const database = getDatabase().pool;
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId,
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    memberships: new PgMembershipAdminRepository(database),
  };
}

/** [BM-015] Request-scoped membership administration composition. */
export function membershipAdminHandlerDependencies(
  requestId: string,
): MembershipAdminHandlerDependencies {
  const dependencies = commandDependencies(requestId);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    changeRole: (request) => changeMembershipRole(request, dependencies),
    removeMember: (request) => removeHouseMember(request, dependencies),
    leaveHouse: (request) => leaveHouse(request, dependencies),
    transferOwnership: (request) => transferHouseOwnership(request, dependencies),
    logger: getLogger(),
    clock,
  };
}
