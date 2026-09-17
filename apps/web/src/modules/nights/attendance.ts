import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import { createAuthorizeHouseAction, joinNight, leaveNight } from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgNightAttendanceRepository,
} from '@between-moves/db';
import type { NightAttendanceDependencies } from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createNightAttendanceEventRecorder,
  createNightJoinLeaveRecorder,
} from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import type { NightAttendanceHandlerDependencies } from '../../server/night-attendance-handler';
import { requireViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function requestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function dependencies(request: Request): NightAttendanceDependencies {
  const database = getDatabase().pool;
  const id = requestId(request);
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: { isAssignedNightHost: async () => false },
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: id,
      }),
    }),
    attendance: new PgNightAttendanceRepository(database),
    clock,
    ids: { generate: () => generateUuidV7() },
    events: createNightAttendanceEventRecorder({ logger: getLogger(), requestId: id }),
    joinLeave: createNightJoinLeaveRecorder({ logger: getLogger(), requestId: id }),
  };
}

/** [BM-036] Web composition for durable Night join/leave and attendance accrual. */
export function nightAttendanceHandlerDependencies(
  request: Request,
): NightAttendanceHandlerDependencies {
  const attendanceDependencies = dependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    joinNight: (command) => joinNight(command, attendanceDependencies),
    leaveNight: (command) => leaveNight(command, attendanceDependencies),
  };
}
