import {
  HouseAuthorizationDeniedError,
  PermanentOutboxError,
  type ClaimedOutboxEvent,
  type ClosingBookRecord,
  type ClosingBookSource,
  type ClosingBookWriter,
  type HouseClosingBook,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createClosingBookConsumer, readClosingBook, repairClosingBooks } from './closing-book';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000004701';
const eventId = '01941f29-7c00-7000-8000-000000004711';
const bookId = '01941f29-7c00-7000-8000-000000004801';
const ada = { membershipId: '01941f29-7c00-7000-8000-000000000621', displayName: 'Ada' };
const closingAt = new Date('2026-10-02T13:00:00.000Z');
const now = new Date('2026-10-02T13:00:05.000Z');

const source: ClosingBookSource = {
  season: {
    seasonId,
    title: 'Autumn tables',
    startsAt: '2026-09-04T12:00:00.000Z',
    endsAt: '2026-10-02T12:00:00.000Z',
    closingAt: closingAt.toISOString(),
  },
  standings: [{ ...ada, rank: 1, points: 3 }],
  games: [],
  swings: [],
  puzzles: [],
  nightsHeld: 0,
  attendance: [{ membershipId: ada.membershipId, nights: 3 }],
};

/** A claimed `season.closing` event as BM-047 enqueues it, adjusted by `overrides`. */
function closingEvent(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: eventId,
    topic: 'season.closing',
    aggregateId: seasonId,
    sequence: 3n,
    houseId,
    payload: {
      seasonId,
      actorMembershipId: ada.membershipId,
      closingAt: closingAt.toISOString(),
      standings: [{ membershipId: ada.membershipId, rank: 1, points: 3 }],
    },
    availableAt: closingAt,
    occurredAt: closingAt,
    attempts: 1,
    ...overrides,
  };
}

/** Consumer ports over a stored book (none by default) that generate and publish successfully. */
function dependencies(existing: ClosingBookRecord | null = null) {
  const books = {
    findBySeason: vi.fn<ClosingBookWriter['findBySeason']>(async () => existing),
    readSource: vi.fn<ClosingBookWriter['readSource']>(async () => source),
    saveGenerated: vi.fn<ClosingBookWriter['saveGenerated']>(async (input) => ({
      bookId: input.bookId,
      state: 'generated' as const,
    })),
    publish: vi.fn<ClosingBookWriter['publish']>(async () => true),
  };
  return {
    books,
    ids: { generate: vi.fn(() => bookId) },
    clock: { now: vi.fn(() => now) },
    events: { record: vi.fn() },
  };
}

describe('Closing Book consumer', () => {
  it('[BM-048] generates the Season’s book privately, then publishes it to the House', async () => {
    const deps = dependencies();

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).resolves.toBe(
      'processed',
    );

    expect(deps.books.readSource).toHaveBeenCalledWith(houseId, seasonId, closingAt);
    expect(deps.books.saveGenerated).toHaveBeenCalledWith({
      bookId,
      houseId,
      seasonId,
      sourceEventId: eventId,
      generationVersion: 1,
      contents: expect.objectContaining({
        season: source.season,
        participation: [expect.objectContaining({ ...ada, rank: 1, nightsAttended: 3 })],
        awards: [
          { kind: 'season_leader', value: 3, recipients: [ada] },
          { kind: 'night_regular', value: 3, recipients: [ada] },
        ],
      }),
      generatedAt: now,
    });
    expect(deps.books.publish).toHaveBeenCalledWith({ houseId, bookId, publishedAt: now });
    expect(deps.books.saveGenerated.mock.invocationCallOrder[0]).toBeLessThan(
      deps.books.publish.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deps.events.record).toHaveBeenCalledWith({
      eventId,
      houseId,
      seasonId,
      bookId,
      outcome: 'published',
      generationVersion: 1,
    });
  });

  it('[BM-048] resumes a book left generated without composing it again', async () => {
    const deps = dependencies({ bookId, state: 'generated' });

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).resolves.toBe(
      'processed',
    );

    expect(deps.books.readSource).not.toHaveBeenCalled();
    expect(deps.books.saveGenerated).not.toHaveBeenCalled();
    expect(deps.books.publish).toHaveBeenCalledWith({ houseId, bookId, publishedAt: now });
  });

  it('[BM-048] reports a replay of a published book as a duplicate', async () => {
    const deps = dependencies({ bookId, state: 'published' });

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).resolves.toBe(
      'duplicate',
    );

    expect(deps.books.publish).not.toHaveBeenCalled();
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ bookId, outcome: 'duplicate' }),
    );
  });

  it('[BM-048] reports a duplicate when a concurrent delivery published first', async () => {
    const deps = dependencies();
    deps.books.publish.mockResolvedValueOnce(false);

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).resolves.toBe(
      'duplicate',
    );
  });

  it.each([
    ['another topic', closingEvent({ topic: 'season.result-recorded' })],
    ['no House', closingEvent({ houseId: null })],
    [
      'a Season other than the aggregate',
      closingEvent({ payload: { seasonId: bookId, closingAt: closingAt.toISOString() } }),
    ],
    ['no closing instant', closingEvent({ payload: { seasonId } })],
    ['an invalid closing instant', closingEvent({ payload: { seasonId, closingAt: 'soon' } })],
  ])('[BM-048] parks an event with %s', async (_label, event) => {
    const deps = dependencies();

    await expect(createClosingBookConsumer(deps).consume(event)).rejects.toBeInstanceOf(
      PermanentOutboxError,
    );
    expect(deps.books.findBySeason).not.toHaveBeenCalled();
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, bookId: null, outcome: 'failed' }),
    );
  });

  it('[BM-048] parks an event whose Season is missing or has not begun closing', async () => {
    const deps = dependencies();
    deps.books.readSource.mockResolvedValueOnce(null);

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).rejects.toThrow(
      new PermanentOutboxError('Closing Season is unavailable'),
    );
    expect(deps.books.saveGenerated).not.toHaveBeenCalled();
  });

  it('[BM-048] leaves a database failure retriable and records it with the generated book', async () => {
    const deps = dependencies();
    const failure = new Error('connection reset');
    deps.books.publish.mockRejectedValueOnce(failure);

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).rejects.toBe(failure);
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ bookId, outcome: 'failed' }),
    );
  });

  it('[BM-048] keeps a published result when diagnostics are unavailable', async () => {
    const deps = dependencies();
    deps.events.record.mockImplementation(() => {
      throw new Error('log sink offline');
    });

    await expect(createClosingBookConsumer(deps).consume(closingEvent())).resolves.toBe(
      'processed',
    );
  });
});

describe('Closing Book repair', () => {
  const legacy = [
    closingEvent(),
    closingEvent({ id: '01941f29-7c00-7000-8000-000000004712' }),
    closingEvent({ id: '01941f29-7c00-7000-8000-000000004713' }),
  ];

  it('[BM-048] replays closings acknowledged without a book and counts the books it publishes', async () => {
    const findUnboundClosingEvents = vi.fn(async () => legacy);
    const consume = vi
      .fn<(event: ClaimedOutboxEvent) => Promise<'processed' | 'duplicate'>>()
      .mockResolvedValueOnce('processed')
      .mockResolvedValueOnce('duplicate')
      .mockResolvedValueOnce('processed');

    await expect(
      repairClosingBooks({ books: { findUnboundClosingEvents }, consumer: { consume } }, 5),
    ).resolves.toBe(2);
    expect(findUnboundClosingEvents).toHaveBeenCalledWith(5);
    expect(consume.mock.calls.map(([event]) => event.id)).toEqual(legacy.map((event) => event.id));
  });

  it('[BM-048] leaves a failing Season for the next run without blocking the others', async () => {
    const consume = vi
      .fn<(event: ClaimedOutboxEvent) => Promise<'processed' | 'duplicate'>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue('processed');

    await expect(
      repairClosingBooks({
        books: { findUnboundClosingEvents: async () => legacy },
        consumer: { consume },
      }),
    ).resolves.toBe(2);
    expect(consume).toHaveBeenCalledTimes(3);
  });

  it('[BM-048] asks for ten closings by default and does nothing when every book is bound', async () => {
    const findUnboundClosingEvents = vi.fn(async () => []);
    const consume = vi.fn();

    await expect(
      repairClosingBooks({ books: { findUnboundClosingEvents }, consumer: { consume } }),
    ).resolves.toBe(0);
    expect(findUnboundClosingEvents).toHaveBeenCalledWith(10);
    expect(consume).not.toHaveBeenCalled();
  });
});

describe('Closing Book read', () => {
  const viewer = {
    kind: 'authenticated',
    userId: '01941f29-7c00-7000-8000-000000000611',
    displayName: 'Ada',
    imageUrl: null,
  } as const;
  const shelf: HouseClosingBook = {
    houseName: 'Knights at Dusk',
    timeZone: 'Asia/Kolkata',
    season: { seasonId, title: 'Autumn tables' },
    book: null,
  };

  it('[BM-048] reads the latest Closing Book through House view authority', async () => {
    const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
    const authorizeHouseAction = vi.fn(async () => context);
    const readLatest = vi.fn(async () => shelf);

    await expect(
      readClosingBook({ houseId, viewer }, { authorizeHouseAction, books: { readLatest } }),
    ).resolves.toBe(shelf);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(readLatest).toHaveBeenCalledWith(context);
  });

  it('[BM-048] denies a non-member before reading any book', async () => {
    const denial = new HouseAuthorizationDeniedError('not_a_member', true);
    const readLatest = vi.fn(async () => shelf);

    await expect(
      readClosingBook(
        { houseId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw denial;
          }),
          books: { readLatest },
        },
      ),
    ).rejects.toBe(denial);
    expect(readLatest).not.toHaveBeenCalled();
  });
});
