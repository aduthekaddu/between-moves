import {
  createAuthorizeHouseAction,
  readClosingBook as readClosingBookUseCase,
} from '@between-moves/application';
import {
  PgClosingBookRepository,
  PgHouseAuthorizationMembershipRepository,
} from '@between-moves/db';
import {
  HouseAuthorizationDeniedError,
  type HouseClosingBook,
  type ReadClosingBookRequest,
  type Viewer,
} from '@between-moves/domain';
import {
  createHouseAuthorizationMetricStubs,
  type StructuredLogger,
} from '@between-moves/observability';
import { readRequestId } from '../../kernel/request';
import { getDatabase } from '../../server/database';
import { createHouseAuthorizationDenialRecorder } from '../../server/house-authorization-observability';
import { getLogger } from '../../server/logger';
import { getViewer } from '../../server/viewer';

export interface ClosingBookReaderDependencies {
  readonly getViewer: (request: Request) => Promise<Viewer>;
  readonly readClosingBook: (request: ReadClosingBookRequest) => Promise<HouseClosingBook | null>;
  readonly logger: StructuredLogger;
  readonly clock: { now(): Date };
}

export type ClosingBookReader = (
  request: Request,
  houseId: string,
) => Promise<HouseClosingBook | null>;

/**
 * [BM-048] Read the House's latest Closing Book, hiding the House from anyone who is not an
 * active Member. Each render of a published book records `bm.closing_book.viewed` (AE-24).
 * [BM-049] The event names the reader's membership and role, so a non-owner's return to the
 * book — the pilot's renewal signal — can be told apart from the Owner's own reading.
 */
export function createClosingBookReader(
  dependencies: ClosingBookReaderDependencies,
): ClosingBookReader {
  return async (request, houseId) => {
    const startedAt = dependencies.clock.now();
    const viewer = await dependencies.getViewer(request);
    let shelf: HouseClosingBook | null;
    try {
      shelf = await dependencies.readClosingBook({ houseId, viewer });
    } catch (error) {
      if (error instanceof HouseAuthorizationDeniedError) return null;
      throw error;
    }
    if (shelf === null || shelf.season === null || shelf.book === null) return shelf;
    try {
      dependencies.logger.log({
        level: 'info',
        requestId: readRequestId(request),
        actorId: viewer.kind === 'authenticated' ? viewer.userId : 'anonymous',
        houseId,
        gameId: null,
        commandId: null,
        event: 'bm.closing_book.viewed',
        outcome: 'success',
        durationMs: Math.max(0, dependencies.clock.now().getTime() - startedAt.getTime()),
        data: {
          season_id: shelf.season.seasonId,
          closing_book_id: shelf.book.bookId,
          generation_version: shelf.book.generationVersion,
          actor_membership_id: shelf.membershipId,
          actor_role: shelf.membershipRole,
        },
      });
    } catch {
      // The book is still shown when the analytics sink is unavailable.
    }
    return shelf;
  };
}

const authorizationMetrics = createHouseAuthorizationMetricStubs();

/** [BM-048] Web composition for the House-scoped Closing Book page. */
export function readHouseClosingBook(
  request: Request,
  houseId: string,
): Promise<HouseClosingBook | null> {
  const database = getDatabase().pool;
  return createClosingBookReader({
    getViewer,
    readClosingBook: (query) =>
      readClosingBookUseCase(query, {
        authorizeHouseAction: createAuthorizeHouseAction({
          memberships: new PgHouseAuthorizationMembershipRepository(database),
          nightHosts: { isAssignedNightHost: async () => false },
          denials: createHouseAuthorizationDenialRecorder({
            logger: getLogger(),
            metrics: authorizationMetrics,
            requestId: readRequestId(request),
          }),
        }),
        books: new PgClosingBookRepository(database),
      }),
    logger: getLogger(),
    clock: { now: () => new Date() },
  })(request, houseId);
}
