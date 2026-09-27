import type {
  AuthorizationContext,
  ClosingBookAttendance,
  ClosingBookContents,
  ClosingBookGame,
  ClosingBookPuzzle,
  ClosingBookReader,
  ClosingBookRecord,
  ClosingBookSource,
  ClosingBookSwingSource,
  ClosingBookWriter,
  GeneratedClosingBookInput,
  HouseClosingBook,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { readNamedFinalStandings } from './pg-season-closing';

type Row = QueryResultRow & Readonly<Record<string, unknown>>;

const BOOK_STATES = new Set(['generated', 'published']);
const GAME_MODES = new Set(['correspondence', 'live']);
const GAME_RESULTS = new Set(['white_win', 'black_win', 'draw']);
const GAME_REASONS = new Set([
  'checkmate',
  'stalemate',
  'insufficient_material',
  'repetition',
  'fifty_move',
  'flag',
  'resign',
  'agreement',
  'timeout',
]);

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Closing Book ${field}`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Closing Book ${field}`);
  }
  return value;
}

function instant(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Closing Book ${field}`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: ReadonlySet<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`Invalid Closing Book ${field}`);
  }
  return value as T;
}

function record(row: Row): ClosingBookRecord {
  return {
    bookId: text(row.id, 'id'),
    state: oneOf(row.state, BOOK_STATES, 'state'),
  };
}

/** Accept only a version-1 payload written for the Season it is stored against. */
function contents(value: unknown, seasonId: string): ClosingBookContents {
  const payload = value as Partial<Record<keyof ClosingBookContents, unknown>> | null;
  const season = payload?.season as { seasonId?: unknown } | undefined;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    season?.seasonId !== seasonId ||
    typeof payload.totals !== 'object' ||
    payload.totals === null ||
    !Array.isArray(payload.participation) ||
    !Array.isArray(payload.awards) ||
    !Array.isArray(payload.swings) ||
    !Array.isArray(payload.games) ||
    !Array.isArray(payload.puzzles)
  ) {
    throw new Error('Invalid Closing Book payload');
  }
  return payload as ClosingBookContents;
}

async function readOnlySnapshot<T>(
  database: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function completedGames(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  closingAt: Date,
): Promise<readonly ClosingBookGame[]> {
  const result = await client.query<Row>(
    `select g.id::text, g.mode, g.result, g.result_reason, g.current_ply, g.completed_at,
            g.white_membership_id::text as white_id,
            coalesce(wm.display_name_snapshot, wu.display_name) as white_name,
            g.black_membership_id::text as black_id,
            coalesce(bm.display_name_snapshot, bu.display_name) as black_name
       from games g
       join memberships wm on wm.id = g.white_membership_id and wm.house_id = g.house_id
       join users wu on wu.id = wm.user_id
       join memberships bm on bm.id = g.black_membership_id and bm.house_id = g.house_id
       join users bu on bu.id = bm.user_id
      where g.house_id = $1 and g.season_id = $2 and g.state = 'completed'
        and g.result in ('white_win', 'black_win', 'draw') and g.completed_at <= $3
      order by g.completed_at, g.id`,
    [houseId, seasonId, closingAt],
  );
  return result.rows.map((row) => ({
    gameId: text(row.id, 'Game id'),
    mode: oneOf(row.mode, GAME_MODES, 'Game mode'),
    white: {
      membershipId: text(row.white_id, 'White membership'),
      displayName: text(row.white_name, 'White name'),
    },
    black: {
      membershipId: text(row.black_id, 'Black membership'),
      displayName: text(row.black_name, 'Black name'),
    },
    result: oneOf(row.result, GAME_RESULTS, 'Game result'),
    resultReason: oneOf(row.result_reason, GAME_REASONS, 'Game result reason'),
    plies: integer(row.current_ply, 'Game plies'),
    completedAt: instant(row.completed_at, 'Game completion').toISOString(),
  }));
}

/** Every analyzed swing is a candidate row; the move at `source_ply` is the one that swung. */
async function swings(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  closingAt: Date,
): Promise<readonly ClosingBookSwingSource[]> {
  const result = await client.query<Row>(
    `select c.game_id::text, c.source_ply, c.evaluation_swing_cp, m.san,
            m.actor_membership_id::text as mover_id
       from puzzle_candidates c
       join moves m on m.game_id = c.game_id and m.house_id = c.house_id and m.ply = c.source_ply
      where c.house_id = $1 and c.season_id = $2 and c.created_at <= $3
      order by c.evaluation_swing_cp desc, c.game_id, c.source_ply`,
    [houseId, seasonId, closingAt],
  );
  return result.rows.map((row) => ({
    gameId: text(row.game_id, 'swing Game id'),
    ply: integer(row.source_ply, 'swing ply'),
    san: text(row.san, 'swing move'),
    moverMembershipId: text(row.mover_id, 'swing mover'),
    swingCp: integer(row.evaluation_swing_cp, 'swing size'),
  }));
}

async function puzzles(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  closingAt: Date,
): Promise<readonly ClosingBookPuzzle[]> {
  const result = await client.query<Row>(
    `select p.id::text, p.prompt, p.position_fen, p.published_at,
            p.contributor_membership_id::text as contributor_id,
            coalesce(m.display_name_snapshot, u.display_name) as contributor_name
       from house_puzzles p
       join memberships m on m.id = p.contributor_membership_id and m.house_id = p.house_id
       join users u on u.id = m.user_id
      where p.house_id = $1 and p.season_id = $2 and p.published_at <= $3
      order by p.published_at, p.id`,
    [houseId, seasonId, closingAt],
  );
  return result.rows.map((row) => ({
    puzzleId: text(row.id, 'Puzzle id'),
    prompt: text(row.prompt, 'Puzzle prompt'),
    positionFen: text(row.position_fen, 'Puzzle position'),
    contributor: {
      membershipId: text(row.contributor_id, 'Puzzle contributor'),
      displayName: text(row.contributor_name, 'Puzzle contributor name'),
    },
    publishedAt: instant(row.published_at, 'Puzzle publication').toISOString(),
  }));
}

async function nightsHeld(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  closingAt: Date,
): Promise<number> {
  const result = await client.query<Row>(
    `select count(*)::int as nights
       from house_nights
      where house_id = $1 and season_id = $2 and state in ('live', 'ended')
        and started_at <= $3`,
    [houseId, seasonId, closingAt],
  );
  return integer(result.rows[0]?.nights, 'Nights held');
}

async function attendance(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  closingAt: Date,
): Promise<readonly ClosingBookAttendance[]> {
  const result = await client.query<Row>(
    `select a.membership_id::text, count(*)::int as nights
       from night_attendance a
       join house_nights n on n.id = a.night_id and n.house_id = a.house_id
      where a.house_id = $1 and n.season_id = $2 and a.qualified_at <= $3
      group by a.membership_id
      order by a.membership_id`,
    [houseId, seasonId, closingAt],
  );
  return result.rows.map((row) => ({
    membershipId: text(row.membership_id, 'attendance membership'),
    nights: integer(row.nights, 'attendance count'),
  }));
}

/**
 * [BM-048] PostgreSQL Closing Book authority. Generation is private: only a published book is
 * ever returned to a House Member, and publication is its only permitted change.
 */
export class PgClosingBookRepository implements ClosingBookWriter, ClosingBookReader {
  constructor(private readonly database: Pool) {}

  async findBySeason(houseId: string, seasonId: string): Promise<ClosingBookRecord | null> {
    const result = await this.database.query<Row>(
      `select id::text, state from closing_books where house_id = $1 and season_id = $2`,
      [houseId, seasonId],
    );
    const row = result.rows[0];
    return row === undefined ? null : record(row);
  }

  /**
   * Read one consistent snapshot of a closing or closed Season, cut off at its closing instant.
   * Return null when the Season is missing from this House or has not begun closing.
   */
  async readSource(
    houseId: string,
    seasonId: string,
    closingAt: Date,
  ): Promise<ClosingBookSource | null> {
    return readOnlySnapshot(this.database, async (client) => {
      const season = await client.query<Row>(
        `select id::text, title, starts_at, ends_at
           from seasons
          where id = $2 and house_id = $1 and state in ('closing', 'closed')`,
        [houseId, seasonId],
      );
      const row = season.rows[0];
      if (row === undefined) return null;
      return {
        season: {
          seasonId: text(row.id, 'Season id'),
          title: text(row.title, 'Season title'),
          startsAt: instant(row.starts_at, 'Season start').toISOString(),
          endsAt: instant(row.ends_at, 'Season end').toISOString(),
          closingAt: closingAt.toISOString(),
        },
        standings: await readNamedFinalStandings(client, houseId, seasonId),
        games: await completedGames(client, houseId, seasonId, closingAt),
        swings: await swings(client, houseId, seasonId, closingAt),
        puzzles: await puzzles(client, houseId, seasonId, closingAt),
        nightsHeld: await nightsHeld(client, houseId, seasonId, closingAt),
        attendance: await attendance(client, houseId, seasonId, closingAt),
      };
    });
  }

  async saveGenerated(input: GeneratedClosingBookInput): Promise<ClosingBookRecord> {
    const inserted = await this.database.query<Row>(
      `insert into closing_books
        (id, house_id, season_id, source_event_id, generation_version, state, payload,
         generated_at)
       values ($1, $2, $3, $4, $5, 'generated', $6, $7)
       on conflict do nothing
       returning id::text, state`,
      [
        input.bookId,
        input.houseId,
        input.seasonId,
        input.sourceEventId,
        input.generationVersion,
        input.contents,
        input.generatedAt,
      ],
    );
    const row = inserted.rows[0];
    if (row !== undefined) return record(row);
    const existing = await this.findBySeason(input.houseId, input.seasonId);
    if (existing === null) throw new Error('Closing Book conflict without an existing book');
    return existing;
  }

  async publish(input: {
    readonly houseId: string;
    readonly bookId: string;
    readonly publishedAt: Date;
  }): Promise<boolean> {
    const published = await this.database.query(
      `update closing_books
          set state = 'published', published_at = $3
        where id = $1 and house_id = $2 and state = 'generated'`,
      [input.bookId, input.houseId, input.publishedAt],
    );
    if (published.rowCount === 1) return true;
    const existing = await this.database.query(
      'select 1 from closing_books where id = $1 and house_id = $2',
      [input.bookId, input.houseId],
    );
    if (existing.rowCount === 0) throw new Error('Closing Book is unavailable');
    return false;
  }

  /**
   * The closing or most recently closed Season and, once published, its Closing Book.
   * A Season still `closing` wins; otherwise the latest close time, then Season ID.
   * Return null when the House or the viewer's membership is not active.
   */
  async readLatest(context: AuthorizationContext): Promise<HouseClosingBook | null> {
    const result = await this.database.query<Row>(
      `select h.name, h.time_zone, s.id::text as season_id, s.title,
              b.id::text as book_id, b.generation_version, b.payload, b.published_at
         from houses h
         join memberships viewer
           on viewer.house_id = h.id and viewer.user_id = $2 and viewer.status = 'active'
         left join lateral (
           select id, title
             from seasons
            where house_id = h.id and state in ('closing', 'closed')
            order by state = 'closing' desc, closed_at desc, id desc
            limit 1
         ) s on true
         left join closing_books b
           on b.season_id = s.id and b.house_id = h.id and b.state = 'published'
        where h.id = $1 and h.status = 'active'`,
      [context.houseId, context.viewerId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const houseName = text(row.name, 'House name');
    const timeZone = text(row.time_zone, 'House time zone');
    if (row.season_id === null) return { houseName, timeZone, season: null, book: null };
    const seasonId = text(row.season_id, 'Season id');
    return {
      houseName,
      timeZone,
      season: { seasonId, title: text(row.title, 'Season title') },
      book:
        row.book_id === null
          ? null
          : {
              bookId: text(row.book_id, 'id'),
              generationVersion: integer(row.generation_version, 'generation version'),
              publishedAt: instant(row.published_at, 'publication time'),
              contents: contents(row.payload, seasonId),
            },
    };
  }
}
