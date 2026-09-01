import { SystemClock, generateUuidV7 } from '@between-moves/adapters';
import {
  changeNightSchedule as changeNightScheduleUseCase,
  createAuthorizeHouseAction,
  readScheduledNights as readScheduledNightsUseCase,
} from '@between-moves/application';
import { PgHouseAuthorizationMembershipRepository, PgNightRepository } from '@between-moves/db';
import type { HouseNightView, NightDependencies } from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  createNightScheduleChangeRecorder,
} from '@between-moves/observability';
import { getConfig } from '../config';
import { getDatabase } from './database';
import { createHouseAuthorizationDenialRecorder } from './house-authorization-observability';
import { getLogger } from './logger';
import type { NightCommandHandlerDependencies } from './night-command-handler';
import { getViewer, requireViewer } from './viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function dependencies(requestId: string): NightDependencies {
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
    nights: new PgNightRepository(database),
    changes: createNightScheduleChangeRecorder({ logger: getLogger(), requestId }),
  };
}

function requestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

/** [BM-020] Web composition for Night schedule edits. */
export function nightCommandHandlerDependencies(request: Request): NightCommandHandlerDependencies {
  const nightDependencies = dependencies(requestId(request));
  return {
    expectedOrigin: getConfig().appOrigin.origin,
    requireViewer,
    changeNightSchedule: (command) => changeNightScheduleUseCase(command, nightDependencies),
  };
}

/** [BM-020] Member-scoped scheduled Nights read. */
export async function getScheduledNights(
  request: Request,
  houseId: string,
): Promise<readonly HouseNightView[]> {
  const nightDependencies = dependencies(requestId(request));
  return readScheduledNightsUseCase(
    { houseId, viewer: await getViewer(request) },
    nightDependencies,
  );
}
