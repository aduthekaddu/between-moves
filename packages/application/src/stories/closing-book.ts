import {
  CLOSING_BOOK_GENERATION_VERSION,
  composeClosingBook,
  PermanentOutboxError,
  SEASON_CLOSING_TOPIC,
  type ClaimedOutboxEvent,
  type ClosingBookEventRecorder,
  type ClosingBookOutcome,
  type ClosingBookWriter,
  type Clock,
  type HouseClosingBook,
  type IdGenerator,
  type OutboxConsumer,
  type ReadClosingBookDependencies,
  type ReadClosingBookRequest,
} from '@between-moves/domain';

export interface ClosingBookConsumerDependencies {
  readonly books: ClosingBookWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly events: ClosingBookEventRecorder;
}

interface ClosingEvent {
  readonly houseId: string;
  readonly seasonId: string;
  readonly closingAt: Date;
}

function invalidEvent(): PermanentOutboxError {
  return new PermanentOutboxError('Invalid Season closing event');
}

function closingEvent(event: ClaimedOutboxEvent): ClosingEvent {
  const { seasonId, closingAt } = event.payload;
  if (event.houseId === null || seasonId !== event.aggregateId) throw invalidEvent();
  if (typeof closingAt !== 'string') throw invalidEvent();
  const instant = new Date(closingAt);
  if (Number.isNaN(instant.getTime())) throw invalidEvent();
  return { houseId: event.houseId, seasonId: event.aggregateId, closingAt: instant };
}

function record(
  event: ClaimedOutboxEvent,
  outcome: ClosingBookOutcome,
  bookId: string | null,
  recorder: ClosingBookEventRecorder,
): void {
  try {
    recorder.record({
      eventId: event.id,
      houseId: event.houseId,
      seasonId: typeof event.payload.seasonId === 'string' ? event.payload.seasonId : null,
      bookId,
      outcome,
      generationVersion: CLOSING_BOOK_GENERATION_VERSION,
    });
  } catch {
    // Diagnostics never alter or replace the Closing Book result.
  }
}

/**
 * [BM-048] Consume `season.closing`: generate the Season's private Closing Book, then publish
 * it to the House. Each step is idempotent, so a retry resumes a book left unpublished and a
 * replay of a published book reports a duplicate.
 */
export function createClosingBookConsumer(
  dependencies: ClosingBookConsumerDependencies,
): OutboxConsumer {
  return {
    async consume(event) {
      let bookId: string | null = null;
      try {
        if (event.topic !== SEASON_CLOSING_TOPIC) {
          throw new PermanentOutboxError('Unsupported Closing Book topic');
        }
        const closing = closingEvent(event);
        let book = await dependencies.books.findBySeason(closing.houseId, closing.seasonId);
        if (book === null) {
          const source = await dependencies.books.readSource(
            closing.houseId,
            closing.seasonId,
            closing.closingAt,
          );
          if (source === null) throw new PermanentOutboxError('Closing Season is unavailable');
          book = await dependencies.books.saveGenerated({
            bookId: dependencies.ids.generate(),
            houseId: closing.houseId,
            seasonId: closing.seasonId,
            sourceEventId: event.id,
            generationVersion: CLOSING_BOOK_GENERATION_VERSION,
            contents: composeClosingBook(source),
            generatedAt: dependencies.clock.now(),
          });
        }
        bookId = book.bookId;
        const publishedNow =
          book.state === 'generated' &&
          (await dependencies.books.publish({
            houseId: closing.houseId,
            bookId: book.bookId,
            publishedAt: dependencies.clock.now(),
          }));
        record(event, publishedNow ? 'published' : 'duplicate', bookId, dependencies.events);
        return publishedNow ? 'processed' : 'duplicate';
      } catch (error) {
        record(event, 'failed', bookId, dependencies.events);
        throw error;
      }
    },
  };
}

/**
 * [BM-048] Read the latest Season's Closing Book for an active House Member. The Season is
 * returned before its book is published so the House can see that one is on its way.
 */
export async function readClosingBook(
  request: ReadClosingBookRequest,
  dependencies: ReadClosingBookDependencies,
): Promise<HouseClosingBook | null> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  return dependencies.books.readLatest(context);
}
