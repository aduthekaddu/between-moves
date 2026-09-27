import {
  AuthenticationRequiredError,
  HouseAuthorizationDeniedError,
  type ClosingBookContents,
  type HouseClosingBook,
} from '@between-moves/domain';
import { createStructuredLogger, type StructuredLogger } from '@between-moves/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClosingBookReader, readHouseClosingBook } from './closingBook';

const composition = vi.hoisted(() => ({
  viewer: {
    kind: 'authenticated',
    userId: '01941f29-7c00-7000-8000-000000000611',
    displayName: 'Ada',
    imageUrl: null,
  } as const,
  membershipStatus: 'active' as 'active' | 'left' | null,
  shelf: null as unknown,
  readLatest: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@between-moves/db', () => ({
  PgHouseAuthorizationMembershipRepository: class {
    async findMembership(input: { houseId: string; viewerId: string }) {
      return composition.membershipStatus === null
        ? null
        : {
            membershipId: '01941f29-7c00-7000-8000-000000000621',
            houseId: input.houseId,
            userId: input.viewerId,
            role: 'member',
            status: composition.membershipStatus,
          };
    }
    async findMembershipById() {
      return null;
    }
  },
  PgClosingBookRepository: class {
    async readLatest(context: unknown) {
      composition.readLatest(context);
      return composition.shelf;
    }
  },
}));
vi.mock('../../server/database', () => ({ getDatabase: () => ({ pool: {} }) }));
vi.mock('../../server/viewer', () => ({ getViewer: async () => composition.viewer }));
vi.mock('../../server/logger', () => ({ getLogger: () => ({ log: composition.log }) }));

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000004901';
const bookId = '01941f29-7c00-7000-8000-000000004903';
const viewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
} as const;
const pending: HouseClosingBook = {
  houseName: 'Knights at Dusk',
  timeZone: 'Asia/Kolkata',
  season: { seasonId, title: 'Autumn tables' },
  book: null,
};
const published: HouseClosingBook = {
  ...pending,
  book: {
    bookId,
    generationVersion: 1,
    publishedAt: new Date('2026-10-02T13:00:06.000Z'),
    contents: { season: { seasonId } } as ClosingBookContents,
  },
};

/** A Closing Book page request carrying a stable request ID. */
function request(): Request {
  return new Request(`https://betweenmoves.test/h/${houseId}/closing-book`, {
    headers: { 'x-request-id': 'bm-048-closing-book-view' },
  });
}

/** A Closing Book reader for the signed-in viewer over the given read and logger. */
function reader(
  readClosingBook: () => Promise<HouseClosingBook | null>,
  logger: StructuredLogger = { log: vi.fn() },
) {
  return createClosingBookReader({
    getViewer: vi.fn(async () => viewer),
    readClosingBook: vi.fn(readClosingBook),
    logger,
    clock: { now: () => new Date('2026-10-03T09:00:00.000Z') },
  });
}

describe('Closing Book request seam', () => {
  it('[BM-048] records bm.closing_book.viewed when a Member reads a published book', async () => {
    const lines: string[] = [];
    const readClosingBook = vi.fn(async () => published);
    const read = createClosingBookReader({
      getViewer: vi.fn(async () => viewer),
      readClosingBook,
      logger: createStructuredLogger({
        clock: { now: () => new Date('2026-10-03T09:00:00.000Z') },
        sink: (line) => lines.push(line),
      }),
      clock: { now: () => new Date('2026-10-03T09:00:00.000Z') },
    });

    await expect(read(request(), houseId)).resolves.toBe(published);
    expect(readClosingBook).toHaveBeenCalledWith({ houseId, viewer });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      request_id: 'bm-048-closing-book-view',
      actor_id: viewer.userId,
      house_id: houseId,
      event: 'bm.closing_book.viewed',
      outcome: 'success',
      data: { season_id: seasonId, closing_book_id: bookId, generation_version: 1 },
    });
  });

  it.each([
    ['a book still being bound', pending],
    ['a House with no closed Season', { ...pending, season: null }],
  ])('[BM-048] does not count a view of %s', async (_label, shelf) => {
    const logger = { log: vi.fn() };

    await expect(reader(async () => shelf, logger)(request(), houseId)).resolves.toBe(shelf);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('[BM-048] hides the House from a non-member without recording a view', async () => {
    const logger = { log: vi.fn() };
    const read = reader(async () => {
      throw new HouseAuthorizationDeniedError('not_a_member', true);
    }, logger);

    await expect(read(request(), houseId)).resolves.toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('[BM-048] lets unexpected read failures reach the error boundary', async () => {
    const failure = new AuthenticationRequiredError();

    await expect(
      reader(async () => {
        throw failure;
      })(request(), houseId),
    ).rejects.toBe(failure);
  });

  it('[BM-048] still shows the book when the analytics sink is unavailable', async () => {
    const logger = {
      log: vi.fn(() => {
        throw new Error('sink offline');
      }),
    };

    await expect(reader(async () => published, logger)(request(), houseId)).resolves.toBe(
      published,
    );
  });
});

describe('Closing Book web composition', () => {
  beforeEach(() => {
    composition.membershipStatus = 'active';
    composition.shelf = published;
    composition.readLatest.mockClear();
    composition.log.mockClear();
  });

  it('[BM-048] reads through House authority with the request viewer and counts the view', async () => {
    await expect(readHouseClosingBook(request(), houseId)).resolves.toBe(published);

    expect(composition.readLatest).toHaveBeenCalledWith({
      viewerId: composition.viewer.userId,
      houseId,
    });
    expect(composition.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'bm-048-closing-book-view',
        actorId: composition.viewer.userId,
        houseId,
        event: 'bm.closing_book.viewed',
      }),
    );
  });

  it.each([
    ['a non-member', null],
    ['a Member who has left', 'left'],
  ] as const)('[BM-048] denies %s before any book is read', async (_label, status) => {
    composition.membershipStatus = status;

    await expect(readHouseClosingBook(request(), houseId)).resolves.toBeNull();
    expect(composition.readLatest).not.toHaveBeenCalled();
    expect(composition.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'house.authorization-denied', houseId }),
    );
    expect(composition.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bm.closing_book.viewed' }),
    );
  });
});
