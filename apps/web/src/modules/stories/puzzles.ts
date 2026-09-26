import { generateUuidV7 } from '@between-moves/adapters';
import {
  createAuthorizeHouseAction,
  publishHousePuzzle as publishHousePuzzleUseCase,
} from '@between-moves/application';
import {
  PgHouseAuthorizationMembershipRepository,
  PgHousePuzzleRepository,
  type HousePuzzleBoard,
  type PublishedHousePuzzle,
} from '@between-moves/db';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { createHouseAuthorizationMetricStubs } from '@between-moves/observability';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getViewer, requireViewer } from '../../server/viewer';

const authorizationMetrics = createHouseAuthorizationMetricStubs();

function authorization(request: Request) {
  return createAuthorizeHouseAction({
    memberships: new PgHouseAuthorizationMembershipRepository(getDatabase().pool),
    nightHosts: { isAssignedNightHost: async () => false },
    denials: createHouseAuthorizationDenialRecorder({
      logger: getLogger(),
      metrics: authorizationMetrics,
      requestId: request.headers.get('x-request-id') ?? 'request-unavailable',
    }),
  });
}

export async function readHousePuzzles(
  request: Request,
  houseId: string,
): Promise<HousePuzzleBoard | null> {
  try {
    const context = await authorization(request)(
      { kind: 'view_house_content' },
      houseId,
      await getViewer(request),
    );
    return new PgHousePuzzleRepository(getDatabase().pool).read(context);
  } catch (error) {
    if (error instanceof HouseAuthorizationDeniedError) return null;
    throw error;
  }
}

/** The confirming Member contributes the prompt and receives the puzzle award. */
export async function publishHousePuzzle(
  request: Request,
  houseId: string,
  input: {
    candidateId: string;
    prompt: string;
  },
): Promise<PublishedHousePuzzle> {
  return publishHousePuzzleUseCase(
    { ...input, houseId, viewer: await requireViewer(request) },
    {
      authorizeHouseAction: authorization(request),
      puzzles: new PgHousePuzzleRepository(getDatabase().pool),
      ids: { generate: () => generateUuidV7() },
      clock: { now: () => new Date() },
    },
  );
}
