import { SystemClock } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  readHouseRoster,
  readPendingInvitations,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgHouseRosterRepository,
} from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type AuthorizeHouseAction,
  type HouseRoster,
  type PendingInvitation,
} from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { readRequestId } from '../../kernel/request';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

function authorizer(request: Request): AuthorizeHouseAction {
  return createAuthorizeHouseAction({
    memberships: new PgHouseAuthorizationMembershipRepository(getDatabase().pool),
    nightHosts: { isAssignedNightHost: async () => false },
    denials: createHouseAuthorizationDenialRecorder({
      logger: getLogger(),
      metrics: authorizationMetrics,
      requestId: readRequestId(request),
    }),
  });
}

/** Denied reads collapse to the caller's fallback so pages never reveal House details. */
async function hidden<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HouseAuthorizationDeniedError) return fallback;
    throw error;
  }
}

/** [BM-015] The active Members of a House, or `null` when the viewer is not one of them. */
export async function getHouseRoster(
  request: Request,
  houseId: string,
): Promise<HouseRoster | null> {
  const viewer = await getViewer(request);
  return hidden(
    () =>
      readHouseRoster(
        { houseId, viewer },
        {
          authorizeHouseAction: authorizer(request),
          roster: new PgHouseRosterRepository(getDatabase().pool),
        },
      ),
    null,
  );
}

/** [BM-014] Usable Invitations for an Owner or Steward; nobody else sees any. */
export async function getPendingInvitations(
  request: Request,
  houseId: string,
): Promise<readonly PendingInvitation[]> {
  const viewer = await getViewer(request);
  return hidden(
    () =>
      readPendingInvitations(
        { houseId, viewer },
        {
          authorizeHouseAction: authorizer(request),
          invitations: new PgHouseRosterRepository(getDatabase().pool),
          clock,
        },
      ),
    [],
  );
}
