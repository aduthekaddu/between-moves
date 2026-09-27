import { composeClosingBook, type AuthorizationContext } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgClosingBookRepository } from './pg-closing-book-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const id = (value: number) => `01941f29-7c00-7000-8000-${String(value).padStart(12, '0')}`;
const seasonId = id(4901);
const closingEventId = id(4902);
const bookId = id(4903);
const gameWon = id(4911);
const gameDrawn = id(4912);
const gameAfterClose = id(4913);
const gameActive = id(4914);
const puzzleId = id(4921);
const nightIds = [id(4931), id(4932), id(4933), id(4934)] as const;
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startsAt = new Date('2026-09-04T12:00:00.000Z');
const endsAt = new Date('2026-10-02T12:00:00.000Z');
const closingAt = new Date('2026-10-02T13:00:00.000Z');
const closedAt = new Date('2026-10-02T13:00:01.000Z');
const generatedAt = new Date('2026-10-02T13:00:05.000Z');
const publishedAt = new Date('2026-10-02T13:00:06.000Z');
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const scholarsMate = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
const scholarsSan = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

integration('BM-048 PostgreSQL Closing Book', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const seasons = new PgSeasonRepository(database);
  const books = new PgClosingBookRepository(database);
  let world: TwoHousesWithMembers;
  let owner: AuthorizationContext;
  let nextId = 5000;

  const ada = () => ({
    membershipId: world.first.member.membershipId,
    displayName: world.first.member.displayName,
  });
  const bea = () => ({
    membershipId: world.first.nonOwner.membershipId,
    displayName: world.first.nonOwner.displayName,
  });
  const mira = () => ({
    membershipId: world.switchingMember.firstMembershipId,
    displayName: world.switchingMember.displayName,
  });

  /** Draft, charter, and publish the first House's Autumn tables Season with four Nights. */
  async function publishSeason(): Promise<void> {
    await seasons.draft(owner, {
      seasonId,
      title: 'Autumn tables',
      idempotencyKey: null,
      createdAt,
    });
    await seasons.draftCharter(owner, {
      charterId: id(nextId++),
      seasonId,
      correspondencePaceHours: 24,
      nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      pointsRecipe: {
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 4, puzzles: 2 },
      },
      createdAt,
    });
    await seasons.publish(owner, {
      seasonId,
      title: 'Autumn tables',
      startsAt,
      endsAt,
      publishedAt: createdAt,
      nightIds,
    });
  }

  /** Insert a correspondence Game in the Season, completed when `finished` is given. */
  async function game(
    gameIdValue: string,
    white: string,
    black: string,
    finished: { result: string; reason: string; plies: number; at: Date } | null,
  ): Promise<void> {
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, current_ply, result, result_reason, created_at, completed_at)
       values ($1, $2, $3, 'correspondence', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        gameIdValue,
        world.first.houseId,
        seasonId,
        finished === null ? 'active' : 'completed',
        white,
        black,
        { kind: 'correspondence', perMoveHours: 24 },
        finished?.plies ?? 2,
        finished?.result ?? null,
        finished?.reason ?? null,
        startsAt,
        finished?.at ?? null,
      ],
    );
  }

  /** Record the Game's first `count` plies of the Scholar's Mate. */
  async function moves(gameIdValue: string, white: string, black: string, count: number) {
    for (let ply = 1; ply <= count; ply += 1) {
      await database.query(
        `insert into moves
          (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
           client_command_id, server_received_at, accepted_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4)`,
        [
          id(nextId++),
          gameIdValue,
          world.first.houseId,
          ply,
          ply % 2 === 1 ? white : black,
          scholarsMate[ply - 1],
          scholarsSan[ply - 1],
          fen,
          id(nextId++),
          startsAt,
        ],
      );
    }
  }

  /** Record an analysed swing at `ply` as a pending puzzle candidate; returns its ID. */
  async function candidate(
    gameIdValue: string,
    ply: number,
    swingCp: number,
    at: Date,
  ): Promise<string> {
    const jobId = id(nextId++);
    const candidateId = id(nextId++);
    await database.query(
      `insert into analysis_jobs
        (id, source_event_id, game_id, house_id, engine_version, state, result, created_at,
         completed_at)
       values ($1, $2, $3, $4, 'v1', 'completed', '{"swings":[]}', $5, $5)`,
      [jobId, id(nextId++), gameIdValue, world.first.houseId, at],
    );
    await database.query(
      `insert into puzzle_candidates
        (id, analysis_job_id, game_id, house_id, season_id, source_ply, position_fen,
         best_line, evaluation_swing_cp, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, '["d1h5"]', $8, $9)`,
      [candidateId, jobId, gameIdValue, world.first.houseId, seasonId, ply, fen, swingCp, at],
    );
    return candidateId;
  }

  /** Append one Season ledger row for a Member. */
  async function award(membershipId: string, sourceKind: string, points: number): Promise<void> {
    await database.query(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id(nextId++),
        world.first.houseId,
        seasonId,
        membershipId,
        sourceKind,
        `test:${nextId}`,
        points,
        createdAt,
      ],
    );
  }

  /** Record a Member's Night attendance, qualifying it when `qualified`. */
  async function attend(nightId: string, membershipId: string, qualified: boolean) {
    const joinedAt = new Date('2026-09-04T14:00:00.000Z');
    await database.query(
      `insert into night_attendance
        (id, house_id, night_id, membership_id, first_joined_at, accumulated_seconds,
         qualified_at, qualification_reason, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $5, $5)`,
      [
        id(nextId++),
        world.first.houseId,
        nightId,
        membershipId,
        joinedAt,
        qualified ? 1_800 : 60,
        qualified ? new Date(joinedAt.getTime() + 1_800_000) : null,
        qualified ? 'duration' : null,
      ],
    );
  }

  /** A Season with two finished Games, swings, one House Puzzle, and two held Nights. */
  async function closeSeasonWithStory(): Promise<void> {
    await publishSeason();
    await game(gameWon, ada().membershipId, bea().membershipId, {
      result: 'white_win',
      reason: 'checkmate',
      plies: 7,
      at: new Date('2026-09-10T10:00:00.000Z'),
    });
    await game(gameDrawn, bea().membershipId, mira().membershipId, {
      result: 'draw',
      reason: 'agreement',
      plies: 4,
      at: new Date('2026-09-20T10:00:00.000Z'),
    });
    await game(gameAfterClose, ada().membershipId, mira().membershipId, {
      result: 'black_win',
      reason: 'resign',
      plies: 2,
      at: new Date('2026-10-02T14:00:00.000Z'),
    });
    await game(gameActive, mira().membershipId, ada().membershipId, null);
    await moves(gameWon, ada().membershipId, bea().membershipId, 7);
    await moves(gameDrawn, bea().membershipId, mira().membershipId, 4);
    const nf6 = await candidate(gameWon, 6, 950, new Date('2026-09-10T10:05:00.000Z'));
    await candidate(gameWon, 4, 210, new Date('2026-09-10T10:05:00.000Z'));
    await candidate(gameDrawn, 3, 320, new Date('2026-09-20T10:05:00.000Z'));
    await candidate(gameDrawn, 4, 800, new Date('2026-10-02T13:30:00.000Z'));
    await database.query(
      `insert into house_puzzles
        (id, candidate_id, house_id, season_id, game_id, position_fen, prompt,
         contributor_membership_id, confirmed_by_membership_id, published_at)
       values ($1, $2, $3, $4, $5, $6, 'White to play and win.', $7, $7, $8)`,
      [
        puzzleId,
        nf6,
        world.first.houseId,
        seasonId,
        gameWon,
        fen,
        ada().membershipId,
        new Date('2026-09-15T10:00:00.000Z'),
      ],
    );
    for (const [index, state] of ['ended', 'ended', 'cancelled'].entries()) {
      await database.query(
        `update house_nights
            set state = $2,
                started_at = case when $2 = 'ended' then $3::timestamptz end,
                ended_at = case when $2 = 'ended' then $4::timestamptz end
          where id = $1`,
        [
          nightIds[index],
          state,
          new Date(Date.UTC(2026, 8, 4 + index * 7, 14)),
          new Date(Date.UTC(2026, 8, 4 + index * 7, 16)),
        ],
      );
    }
    await attend(nightIds[0], ada().membershipId, true);
    await attend(nightIds[1], ada().membershipId, true);
    await attend(nightIds[0], bea().membershipId, false);
    await attend(nightIds[1], mira().membershipId, true);
    await award(ada().membershipId, 'game_win', 3);
    await award(ada().membershipId, 'game_played', 1);
    await award(ada().membershipId, 'night_attendance', 1);
    await award(ada().membershipId, 'night_attendance', 1);
    await award(ada().membershipId, 'puzzle_published', 1);
    await award(bea().membershipId, 'game_played', 1);
    await award(bea().membershipId, 'game_draw', 2);
    await award(bea().membershipId, 'game_played', 1);
    await award(mira().membershipId, 'game_draw', 2);
    await award(mira().membershipId, 'game_played', 1);
    await seasons.beginClosing(owner, { seasonId, closingEventId, closingAt });
    await seasons.finalize(owner, { seasonId, closedAt });
  }

  /** Read the closed Season's source and store its unpublished book. */
  async function generate(): Promise<void> {
    const source = await books.readSource(world.first.houseId, seasonId, closingAt);
    if (source === null) throw new Error('Closing Book source is unavailable');
    await books.saveGenerated({
      bookId,
      houseId: world.first.houseId,
      seasonId,
      sourceEventId: closingEventId,
      generationVersion: 1,
      contents: composeClosingBook(source),
      generatedAt,
    });
  }

  /** An authorization context for a viewer in a House (the first House by default). */
  function member(viewerId: string, houseId = world.first.houseId): AuthorizationContext {
    return fakeAuthorizationContext({ viewerId, houseId });
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    owner = member(world.first.member.userId);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-048] reads the closed Season’s facts as they stood at the closing instant', async () => {
    await closeSeasonWithStory();

    await expect(books.readSource(world.first.houseId, seasonId, closingAt)).resolves.toEqual({
      season: {
        seasonId,
        title: 'Autumn tables',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        closingAt: closingAt.toISOString(),
      },
      standings: [
        { ...ada(), rank: 1, points: 7 },
        { ...bea(), rank: 2, points: 4 },
        { ...mira(), rank: 3, points: 3 },
      ],
      games: [
        {
          gameId: gameWon,
          mode: 'correspondence',
          white: ada(),
          black: bea(),
          result: 'white_win',
          resultReason: 'checkmate',
          plies: 7,
          completedAt: '2026-09-10T10:00:00.000Z',
        },
        {
          gameId: gameDrawn,
          mode: 'correspondence',
          white: bea(),
          black: mira(),
          result: 'draw',
          resultReason: 'agreement',
          plies: 4,
          completedAt: '2026-09-20T10:00:00.000Z',
        },
      ],
      swings: [
        {
          gameId: gameWon,
          ply: 6,
          san: 'Nf6',
          moverMembershipId: bea().membershipId,
          swingCp: 950,
        },
        {
          gameId: gameDrawn,
          ply: 3,
          san: 'Qh5',
          moverMembershipId: bea().membershipId,
          swingCp: 320,
        },
        {
          gameId: gameWon,
          ply: 4,
          san: 'Nc6',
          moverMembershipId: bea().membershipId,
          swingCp: 210,
        },
      ],
      puzzles: [
        {
          puzzleId,
          prompt: 'White to play and win.',
          positionFen: fen,
          contributor: ada(),
          publishedAt: '2026-09-15T10:00:00.000Z',
        },
      ],
      nightsHeld: 2,
      attendance: [
        { membershipId: ada().membershipId, nights: 2 },
        { membershipId: mira().membershipId, nights: 1 },
      ],
    });
  });

  it('[BM-048] generates a book with participation, games, swings, puzzles, and awards', async () => {
    await closeSeasonWithStory();
    await generate();
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });

    const shelf = await books.readLatest(member(world.first.nonOwner.userId));

    expect(shelf?.book?.contents).toMatchObject({
      totals: { members: 3, gamesCompleted: 2, nightsHeld: 2, puzzlesPublished: 1 },
      participation: [
        { ...ada(), rank: 1, points: 7, gamesCompleted: 1, wins: 1, nightsAttended: 2 },
        { ...bea(), rank: 2, points: 4, gamesCompleted: 2, draws: 1, losses: 1 },
        { ...mira(), rank: 3, points: 3, gamesCompleted: 1, draws: 1, nightsAttended: 1 },
      ],
      games: [{ gameId: gameWon }, { gameId: gameDrawn }],
      swings: [
        { gameId: gameWon, ply: 6, san: 'Nf6', mover: bea(), opponent: ada(), swingCp: 950 },
        { gameId: gameDrawn, ply: 3, san: 'Qh5', mover: bea(), opponent: mira(), swingCp: 320 },
      ],
      puzzles: [{ puzzleId, contributor: ada() }],
      awards: [
        { kind: 'season_leader', value: 7, recipients: [ada()] },
        { kind: 'most_games', value: 2, recipients: [bea()] },
        { kind: 'most_wins', value: 1, recipients: [ada()] },
        { kind: 'night_regular', value: 2, recipients: [ada()] },
        { kind: 'puzzle_setter', value: 1, recipients: [ada()] },
      ],
    });
  });

  it('[BM-048] keeps a generated book private until it is published to the House', async () => {
    await closeSeasonWithStory();
    await generate();

    await expect(books.findBySeason(world.first.houseId, seasonId)).resolves.toEqual({
      bookId,
      state: 'generated',
    });
    await expect(books.readLatest(member(world.first.nonOwner.userId))).resolves.toEqual({
      houseName: world.first.name,
      timeZone: 'Asia/Kolkata',
      membershipId: bea().membershipId,
      membershipRole: 'member',
      season: { seasonId, title: 'Autumn tables' },
      activeSeason: null,
      book: null,
    });

    await expect(
      books.publish({ houseId: world.first.houseId, bookId, publishedAt }),
    ).resolves.toBe(true);

    const shelf = await books.readLatest(member(world.first.nonOwner.userId));
    expect(shelf).toMatchObject({
      houseName: world.first.name,
      season: { seasonId, title: 'Autumn tables' },
      book: { bookId, generationVersion: 1, publishedAt },
    });
    expect(shelf?.book?.contents.season.seasonId).toBe(seasonId);
  });

  it('[BM-048] generates and publishes each Season’s book exactly once', async () => {
    await closeSeasonWithStory();
    await generate();
    const source = await books.readSource(world.first.houseId, seasonId, closingAt);
    if (source === null) throw new Error('Closing Book source is unavailable');

    await expect(
      books.saveGenerated({
        bookId: id(4904),
        houseId: world.first.houseId,
        seasonId,
        sourceEventId: id(4905),
        generationVersion: 1,
        contents: composeClosingBook(source),
        generatedAt,
      }),
    ).resolves.toEqual({ bookId, state: 'generated' });
    await expect(
      books.publish({ houseId: world.first.houseId, bookId, publishedAt }),
    ).resolves.toBe(true);
    await expect(
      books.publish({ houseId: world.first.houseId, bookId, publishedAt: closedAt }),
    ).resolves.toBe(false);

    const rows = await database.query(
      'select id::text, state, published_at from closing_books where season_id = $1',
      [seasonId],
    );
    expect(rows.rows).toEqual([{ id: bookId, state: 'published', published_at: publishedAt }]);
  });

  it('[BM-048] freezes a published book and allows only publication before it', async () => {
    await closeSeasonWithStory();
    await generate();

    await expect(
      database.query(`update closing_books set payload = '{}' where id = $1`, [bookId]),
    ).rejects.toMatchObject({ code: '55000' });
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });
    await expect(
      database.query(`update closing_books set published_at = now() where id = $1`, [bookId]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.query(
        `insert into closing_books
          (id, house_id, season_id, source_event_id, generation_version, state, payload,
           generated_at, published_at)
         values ($1, $2, $3, $4, 1, 'published', '{}', $5, null)`,
        [id(4906), world.first.houseId, id(4908), id(4907), generatedAt],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('[BM-048] finds closings acknowledged without a published book until one is bound', async () => {
    await closeSeasonWithStory();
    await expect(books.findUnboundClosingEvents(10)).resolves.toEqual([]);

    await database.query('update outbox_events set sent_at = $2, attempts = 1 where id = $1', [
      closingEventId,
      closedAt,
    ]);
    await expect(books.findUnboundClosingEvents(10)).resolves.toEqual([
      expect.objectContaining({
        id: closingEventId,
        topic: 'season.closing',
        aggregateId: seasonId,
        houseId: world.first.houseId,
        payload: expect.objectContaining({ seasonId, closingAt: closingAt.toISOString() }),
      }),
    ]);
    await expect(books.findUnboundClosingEvents(0)).resolves.toEqual([]);

    await generate();
    await expect(books.findUnboundClosingEvents(10)).resolves.toHaveLength(1);
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });
    await expect(books.findUnboundClosingEvents(10)).resolves.toEqual([]);
  });

  it('[BM-048] never replays a closing event without a closing instant', async () => {
    await closeSeasonWithStory();
    await database.query(
      `update outbox_events set sent_at = $2, attempts = 1, payload = payload - 'closingAt'
        where id = $1`,
      [closingEventId, closedAt],
    );

    await expect(books.findUnboundClosingEvents(10)).resolves.toEqual([]);
  });

  it('[BM-048] never lets closing instants that are not dates crowd out a valid one', async () => {
    await closeSeasonWithStory();
    await database.query('update outbox_events set sent_at = $2, attempts = 1 where id = $1', [
      closingEventId,
      closedAt,
    ]);
    const malformed = [
      'not-a-date',
      'infinity',
      '2026-13-01T00:00:00.000Z',
      '2026-10-02T23:59:60.000Z',
    ];
    for (const [index, value] of malformed.entries()) {
      await database.query(
        `insert into outbox_events
          (id, topic, aggregate_id, sequence, house_id, payload, attempts, sent_at, created_at)
         values ($1, 'season.closing', $2, $3, $4, $5, 1, $6, $7)`,
        [
          id(nextId++),
          seasonId,
          1_000 + index,
          world.first.houseId,
          { seasonId, closingAt: value },
          closedAt,
          createdAt,
        ],
      );
    }

    await expect(books.findUnboundClosingEvents(1)).resolves.toEqual([
      expect.objectContaining({ id: closingEventId }),
    ]);
  });

  it('[BM-048] refuses a Season that has not begun closing or belongs to another House', async () => {
    await publishSeason();

    await expect(books.readSource(world.first.houseId, seasonId, closingAt)).resolves.toBeNull();
    await expect(books.readSource(world.second.houseId, seasonId, closingAt)).resolves.toBeNull();
  });

  it('[BM-048] shows each House only its own Closing Book', async () => {
    await closeSeasonWithStory();
    await generate();
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });

    await expect(
      books.readLatest(member(world.second.member.userId, world.first.houseId)),
    ).resolves.toBeNull();
    await expect(
      books.readLatest(member(world.second.member.userId, world.second.houseId)),
    ).resolves.toEqual({
      houseName: world.second.name,
      timeZone: 'Asia/Kolkata',
      membershipId: world.second.member.membershipId,
      membershipRole: 'owner',
      season: null,
      activeSeason: null,
      book: null,
    });
    await expect(
      books.readLatest(member(world.switchingMember.userId, world.second.houseId)),
    ).resolves.toEqual({
      houseName: world.second.name,
      timeZone: 'Asia/Kolkata',
      membershipId: world.switchingMember.secondMembershipId,
      membershipRole: 'member',
      season: null,
      activeSeason: null,
      book: null,
    });
    await expect(books.findBySeason(world.second.houseId, seasonId)).resolves.toBeNull();
    await expect(
      books.publish({ houseId: world.second.houseId, bookId, publishedAt }),
    ).rejects.toThrow('Closing Book is unavailable');
  });

  it('[BM-048] hides the book from a Member who has left the House', async () => {
    await closeSeasonWithStory();
    await generate();
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });
    await database.query(`update memberships set status = 'left', left_at = now() where id = $1`, [
      bea().membershipId,
    ]);

    await expect(books.readLatest(member(world.first.nonOwner.userId))).resolves.toBeNull();
  });

  it('[BM-049] names each reader’s own membership and role', async () => {
    await closeSeasonWithStory();
    await generate();
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });

    for (const [viewerId, membershipId, membershipRole] of [
      [world.first.member.userId, ada().membershipId, 'owner'],
      [world.switchingMember.userId, mira().membershipId, 'steward'],
      [world.first.nonOwner.userId, bea().membershipId, 'member'],
    ] as const) {
      await expect(books.readLatest(member(viewerId))).resolves.toMatchObject({
        membershipId,
        membershipRole,
        book: { bookId },
      });
    }
  });

  it('[BM-049] keeps the last Season’s book on the shelf once the next Season is active', async () => {
    await closeSeasonWithStory();
    await generate();
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt });
    const before = await books.readLatest(member(world.first.nonOwner.userId));
    const nextSeasonId = id(4991);
    await seasons.draft(owner, {
      seasonId: nextSeasonId,
      title: 'Winter tables',
      idempotencyKey: null,
      createdAt: closedAt,
    });
    await seasons.draftCharter(owner, {
      charterId: id(nextId++),
      seasonId: nextSeasonId,
      correspondencePaceHours: 48,
      nightRecurrence: { weekday: 2, localTime: '20:00', count: 4 },
      pointsRecipe: {
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 4, puzzles: 2 },
      },
      createdAt: closedAt,
    });
    await seasons.publish(owner, {
      seasonId: nextSeasonId,
      title: 'Winter tables',
      startsAt: new Date('2026-10-09T12:00:00.000Z'),
      endsAt: new Date('2026-11-06T12:00:00.000Z'),
      publishedAt: closedAt,
      nightIds: [id(4992), id(4993), id(4994), id(4995)],
    });

    const after = await books.readLatest(member(world.first.nonOwner.userId));

    expect(after).toEqual({
      ...before,
      activeSeason: { seasonId: nextSeasonId, title: 'Winter tables' },
    });
    await expect(books.findBySeason(world.first.houseId, nextSeasonId)).resolves.toBeNull();
    await expect(
      books.readLatest(member(world.second.member.userId, world.second.houseId)),
    ).resolves.toMatchObject({ season: null, activeSeason: null });
  });

  it('[BM-048] rejects a stored payload written for another Season', async () => {
    await closeSeasonWithStory();
    await database.query(
      `insert into closing_books
        (id, house_id, season_id, source_event_id, generation_version, state, payload,
         generated_at, published_at)
       values ($1, $2, $3, $4, 1, 'published', $5, $6, $7)`,
      [
        bookId,
        world.first.houseId,
        seasonId,
        closingEventId,
        { season: { seasonId: id(1) } },
        generatedAt,
        publishedAt,
      ],
    );

    await expect(books.readLatest(member(world.first.nonOwner.userId))).rejects.toThrow(
      'Invalid Closing Book payload',
    );
  });
});
