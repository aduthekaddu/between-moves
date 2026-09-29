import { SystemClock } from '@between-moves/adapters';
import { createAuthorizeHouseAction, readOpenSeats } from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgOpenSeatReadRepository,
} from '@between-moves/db';
import { HouseAuthorizationDeniedError, type OpenSeatListing } from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { readRequestId } from '../../kernel/request';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getViewer } from '../../server/viewer';

const clock = new SystemClock();
const authorizationMetrics = createHouseAuthorizationMetricStubs();

/** [BM-023] Seats waiting for a player; empty when the viewer cannot see this House. */
export async function getOpenSeats(
  request: Request,
  houseId: string,
): Promise<readonly OpenSeatListing[]> {
  const database = getDatabase().pool;
  const viewer = await getViewer(request);
  try {
    return await readOpenSeats(
      { houseId, viewer },
      {
        authorizeHouseAction: createAuthorizeHouseAction({
          memberships: new PgHouseAuthorizationMembershipRepository(database),
          nightHosts: { isAssignedNightHost: async () => false },
          denials: createHouseAuthorizationDenialRecorder({
            logger: getLogger(),
            metrics: authorizationMetrics,
            requestId: readRequestId(request),
          }),
        }),
        seats: new PgOpenSeatReadRepository(database),
        clock,
      },
    );
  } catch (error) {
    if (error instanceof HouseAuthorizationDeniedError) return [];
    throw error;
  }
}
