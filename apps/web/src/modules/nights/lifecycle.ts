import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  assignNightHost,
  createAuthorizeHouseAction,
  endNight,
  readNightHostCandidates,
  rsvpNight,
  startNight,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgNightLifecycleRepository,
  PgNightRsvpRepository,
} from '@between-moves/db';
import type { NightHostCandidate, NightLifecycleDependencies } from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createNightLifecycleRecorder,
} from '@between-moves/observability';
import { getConfig } from '../../config';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import type { NightLifecycleHandlerDependencies } from '../../server/night-lifecycle-handler';
import { getViewer, requireViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function requestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function dependencies(request: Request): NightLifecycleDependencies {
  const database = getDatabase().pool;
  const id = requestId(request);
  const lifecycle = new PgNightLifecycleRepository(database);
  return {
    authorizeHouseAction: createAuthorizeHouseAction({
      memberships: new PgHouseAuthorizationMembershipRepository(database),
      nightHosts: lifecycle,
      denials: createHouseAuthorizationDenialRecorder({
        logger: getLogger(),
        metrics: authorizationMetrics,
        requestId: id,
      }),
    }),
    clock,
    ids: { generate: () => generateUuidV7() },
    lifecycle,
    rsvps: new PgNightRsvpRepository(database),
    changes: createNightLifecycleRecorder({ logger: getLogger(), requestId: id }),
  };
}

/** [BM-035] Web composition for Night RSVP, host assignment, and start/end. */
export function nightLifecycleHandlerDependencies(
  request: Request,
): NightLifecycleHandlerDependencies {
  const lifecycleDependencies = dependencies(request);
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    startNight: (command) => startNight(command, lifecycleDependencies),
    endNight: (command) => endNight(command, lifecycleDependencies),
    assignNightHost: (command) => assignNightHost(command, lifecycleDependencies),
    rsvpNight: (command) => rsvpNight(command, lifecycleDependencies),
  };
}

/** [BM-035] Member-scoped Night host candidates for assignment. */
export async function getNightHostCandidates(
  request: Request,
  houseId: string,
): Promise<readonly NightHostCandidate[]> {
  return readNightHostCandidates(
    { houseId, viewer: await getViewer(request) },
    dependencies(request),
  );
}
