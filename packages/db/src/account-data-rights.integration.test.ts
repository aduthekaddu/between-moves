import {
  AccountDeletionBlockedError,
  composeClosingBook,
  DomainError,
  INVITATION_EMAIL_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  type AccountDeletionInput,
  type AuthorizationContext,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgAccountDataRightsRepository } from './pg-account-data-rights-repository';
import { PgClosingBookRepository } from './pg-closing-book-repository';
import { PgGameNoteRepository } from './pg-game-note-repository';
import { PgGamePositionRepository } from './pg-game-position-repository';
import { PgHouseChatRepository } from './pg-house-chat-repository';
import { PgInvitationEmailDeliveryGate } from './pg-invitation-email-delivery-gate';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const id = (value: number) => `01941f29-7c00-7000-8000-${String(value).padStart(12, '0')}`;
const seasonId = id(5001);
const closingEventId = id(5002);
const bookId = id(5003);
const checkmateGame = id(5011);
const drawnGame = id(5012);
const puzzleId = id(5021);
const nightIds = [id(5031), id(5032), id(5033), id(5034)] as const;
const beaMessage = id(5041);
const adaMessage = id(5042);
const hiddenMessage = id(5043);
const beaEvent = id(5044);
const adaEvent = id(5045);
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startsAt = new Date('2026-09-04T12:00:00.000Z');
const endsAt = new Date('2026-10-02T12:00:00.000Z');
const nightAt = new Date('2026-09-04T14:00:00.000Z');
const closingAt = new Date('2026-10-02T13:00:00.000Z');
const closedAt = new Date('2026-10-02T13:00:01.000Z');
const deletedAt = new Date('2026-10-05T09:00:00.000Z');
const exportedAt = new Date('2026-10-05T08:00:00.000Z');
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const scholarsMate = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
const scholarsSan = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const beaNote = 'I should have seen Qxf7 coming.';
const adaNote = 'Ada’s own reflection on the finish.';

describe('BM-050 PostgreSQL account export and deletion', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const accounts = new PgAccountDataRightsRepository(database);
  const seasons = new PgSeasonRepository(database);
  const books = new PgClosingBookRepository(database);
  let world: TwoHousesWithMembers;
  let nextId = 6000;
  const auditIds = { generate: () => id(nextId++) };

  const ada = () => world.first.member;
  const bea = () => world.first.nonOwner;

  /** An authorization context for a viewer in the first House. */
  function member(viewerId: string, houseId = world.first.houseId): AuthorizationContext {
    return fakeAuthorizationContext({ viewerId, houseId });
  }

  /** Delete one account at the fixed deletion instant. */
  function deletion(userId: string): AccountDeletionInput {
    return { userId, deletedAt, auditIds };
  }

  /** Publish the first House's Season with four Nights. */
  async function publishSeason(): Promise<void> {
    const owner = member(ada().userId);
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

  /** A completed correspondence Game with its first `plies` Scholar's Mate Moves. */
  async function completedGame(
    gameId: string,
    white: string,
    black: string,
    finished: { result: string; reason: string; plies: number; at: Date },
  ): Promise<void> {
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, current_ply, result, result_reason, created_at, completed_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        white,
        black,
        { kind: 'correspondence', perMoveHours: 24 },
        finished.plies,
        finished.result,
        finished.reason,
        startsAt,
        finished.at,
      ],
    );
    for (let ply = 1; ply <= finished.plies; ply += 1) {
      await database.query(
        `insert into moves
          (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
           client_command_id, server_received_at, accepted_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4)`,
        [
          id(nextId++),
          gameId,
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

  /** A Night chat message, with its realtime outbox event when `eventId` is given. */
  async function message(
    messageId: string,
    membershipId: string,
    displayName: string,
    body: string,
    sequence: number,
    eventId: string | null,
  ): Promise<void> {
    const at = new Date(nightAt.getTime() + sequence * 60_000);
    await database.query(
      `insert into house_messages
        (id, house_id, night_id, membership_id, body, sequence, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [messageId, world.first.houseId, nightIds[0], membershipId, body, sequence, at],
    );
    if (eventId === null) return;
    await database.query(
      `insert into outbox_events
        (id, topic, aggregate_id, sequence, house_id, payload, available_at, sent_at, created_at)
       values ($1, $2, $3, 1, $4, $5, $6, $6, $6)`,
      [
        eventId,
        NIGHT_CHAT_POSTED_TOPIC,
        messageId,
        world.first.houseId,
        {
          nightId: nightIds[0],
          messageId,
          membershipId,
          authorDisplayName: displayName,
          body,
          createdAt: at.toISOString(),
          chatSequence: String(sequence),
        },
        at,
      ],
    );
  }

  /**
   * Bea's Season in the first House: she lost to Ada, drew Mira, set a Puzzle, wrote a note, a
   * reaction and chat, and led the final standings of a Season whose Closing Book is published.
   */
  async function beasSeason(): Promise<void> {
    await publishSeason();
    await completedGame(checkmateGame, ada().membershipId, bea().membershipId, {
      result: 'white_win',
      reason: 'checkmate',
      plies: 7,
      at: new Date('2026-09-10T10:00:00.000Z'),
    });
    await completedGame(drawnGame, bea().membershipId, world.switchingMember.firstMembershipId, {
      result: 'draw',
      reason: 'agreement',
      plies: 4,
      at: new Date('2026-09-20T10:00:00.000Z'),
    });
    const jobId = id(nextId++);
    const candidateId = id(nextId++);
    await database.query(
      `insert into analysis_jobs
        (id, source_event_id, game_id, house_id, engine_version, state, result, created_at,
         completed_at)
       values ($1, $2, $3, $4, 'v1', 'completed', '{"swings":[]}', $5, $5)`,
      [jobId, id(nextId++), checkmateGame, world.first.houseId, startsAt],
    );
    await database.query(
      `insert into puzzle_candidates
        (id, analysis_job_id, game_id, house_id, season_id, source_ply, position_fen,
         best_line, evaluation_swing_cp, created_at)
       values ($1, $2, $3, $4, $5, 6, $6, '["h5f7"]', 950, $7)`,
      [candidateId, jobId, checkmateGame, world.first.houseId, seasonId, fen, startsAt],
    );
    await database.query(
      `insert into house_puzzles
        (id, candidate_id, house_id, season_id, game_id, position_fen, prompt,
         contributor_membership_id, confirmed_by_membership_id, published_at)
       values ($1, $2, $3, $4, $5, $6, 'White to play and win.', $7, $7, $8)`,
      [
        puzzleId,
        candidateId,
        world.first.houseId,
        seasonId,
        checkmateGame,
        fen,
        bea().membershipId,
        new Date('2026-09-15T10:00:00.000Z'),
      ],
    );
    for (const [noteId, membershipId, body] of [
      [id(5051), bea().membershipId, beaNote],
      [id(5052), ada().membershipId, adaNote],
    ] as const) {
      await database.query(
        `insert into game_notes (id, game_id, house_id, membership_id, body, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [noteId, checkmateGame, world.first.houseId, membershipId, body, endsAt],
      );
    }
    for (const [reactionId, membershipId, reaction] of [
      [id(5053), bea().membershipId, 'brilliant'],
      [id(5054), ada().membershipId, 'well_played'],
    ] as const) {
      await database.query(
        `insert into game_reactions (id, game_id, house_id, membership_id, reaction, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [reactionId, checkmateGame, world.first.houseId, membershipId, reaction, endsAt],
      );
    }
    await database.query(
      `update house_nights
          set state = 'ended', started_at = $2, ended_at = $3, chat_sequence = 3
        where id = $1`,
      [nightIds[0], nightAt, new Date(nightAt.getTime() + 7_200_000)],
    );
    await message(beaMessage, bea().membershipId, 'Bea', 'Good luck, all.', 1, beaEvent);
    await message(adaMessage, ada().membershipId, 'Ada', 'Welcome back, everyone.', 2, adaEvent);
    await message(hiddenMessage, bea().membershipId, 'Bea', 'Oops, wrong board.', 3, null);
    await database.query(
      `update house_messages set deleted_at = $2, deleted_by_membership_id = $3 where id = $1`,
      [hiddenMessage, new Date(nightAt.getTime() + 240_000), ada().membershipId],
    );
    await award(ada().membershipId, 'game_win', 3);
    await award(ada().membershipId, 'game_played', 1);
    await award(bea().membershipId, 'game_played', 1);
    await award(bea().membershipId, 'game_played', 1);
    await award(bea().membershipId, 'game_draw', 2);
    await award(bea().membershipId, 'puzzle_published', 1);
    await award(world.switchingMember.firstMembershipId, 'game_played', 1);
    await award(world.switchingMember.firstMembershipId, 'game_draw', 2);
    const owner = member(ada().userId);
    await seasons.beginClosing(owner, { seasonId, closingEventId, closingAt });
    await seasons.finalize(owner, { seasonId, closedAt });
    const source = await books.readSource(world.first.houseId, seasonId, closingAt);
    if (source === null) throw new Error('Closing Book source is unavailable');
    await books.saveGenerated({
      bookId,
      houseId: world.first.houseId,
      seasonId,
      sourceEventId: closingEventId,
      generationVersion: 1,
      contents: composeClosingBook(source),
      generatedAt: closedAt,
    });
    await books.publish({ houseId: world.first.houseId, bookId, publishedAt: closedAt });
  }

  /** Sessions, a provider account, and pending sign-in links for Bea and Ada. */
  async function signIns(): Promise<void> {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    await database.query(
      `insert into sessions (id, user_id, token, expires_at, ip_address, user_agent)
       values ($1, $2, $3, $4, '203.0.113.9', 'Bea phone'),
              ($5, $2, $6, $4, '203.0.113.10', 'Bea laptop'),
              ($7, $8, $9, $4, '203.0.113.11', 'Ada laptop')`,
      [
        bea().sessionId,
        bea().userId,
        bea().sessionToken,
        expiresAt,
        id(5061),
        'bm-050-bea-second-session-token-000001',
        ada().sessionId,
        ada().userId,
        ada().sessionToken,
      ],
    );
    await database.query(
      `insert into accounts (id, issuer, account_id, provider_id, user_id)
       values ($1, 'between-moves', $2, 'magic-link', $3)`,
      [id(5062), bea().userId, bea().userId],
    );
    await database.query(
      `insert into verification (id, identifier, value, expires_at)
       values ($1, 'bea-link', $2, $4), ($3, 'ada-link', $5, $4)`,
      [
        id(5063),
        JSON.stringify({ email: 'Bea-Isolation@Example.test', name: 'Bea' }),
        id(5064),
        expiresAt,
        JSON.stringify({ email: 'ada-isolation@example.test', name: 'Ada' }),
      ],
    );
  }

  /** Every shared House record Bea touched, as stored. */
  async function sharedRecords() {
    const read = async (sql: string) => (await database.query(sql)).rows;
    return {
      games: await read('select * from games order by id'),
      moves: await read('select * from moves order by game_id, ply'),
      ledger: await read('select * from season_score_ledger order by id'),
      standings: await read('select * from season_final_standings order by season_id, rank'),
      books: await read('select * from closing_books order by id'),
      puzzles: await read('select * from house_puzzles order by id'),
      messages: await read('select * from house_messages order by id'),
      notes: await read('select * from game_notes order by id'),
      reactions: await read('select * from game_reactions order by id'),
    };
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await beasSeason();
    await signIns();
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-050] exports the person’s profile, memberships, authored content, games, moves, and contributions', async () => {
    const standing = await database.query<{ finalized_at: Date }>(
      'select finalized_at from season_final_standings where membership_id = $1',
      [bea().membershipId],
    );
    const finalizedAt = standing.rows[0]?.finalized_at.toISOString();
    const exported = await accounts.exportAccount(bea().userId, exportedAt);

    expect(exported).toEqual({
      format: 'between-moves.account-export',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      profile: {
        userId: bea().userId,
        displayName: 'Bea',
        email: 'bea-isolation@example.test',
        emailVerified: true,
        imageUrl: null,
        createdAt: expect.any(String),
      },
      memberships: [
        {
          membershipId: bea().membershipId,
          houseId: world.first.houseId,
          houseName: 'Knights at Dusk',
          role: 'member',
          status: 'active',
          joinedAt: '2026-08-30T00:00:00.000Z',
          leftAt: null,
        },
      ],
      authored: {
        messages: [
          {
            messageId: beaMessage,
            houseId: world.first.houseId,
            nightId: nightIds[0],
            body: 'Good luck, all.',
            sentAt: '2026-09-04T14:01:00.000Z',
            removedAt: null,
          },
          {
            messageId: hiddenMessage,
            houseId: world.first.houseId,
            nightId: nightIds[0],
            body: 'Oops, wrong board.',
            sentAt: '2026-09-04T14:03:00.000Z',
            removedAt: '2026-09-04T14:04:00.000Z',
          },
        ],
        notes: [
          {
            noteId: id(5051),
            houseId: world.first.houseId,
            gameId: checkmateGame,
            body: beaNote,
            createdAt: endsAt.toISOString(),
            editedAt: null,
          },
        ],
        reactions: [
          {
            houseId: world.first.houseId,
            gameId: checkmateGame,
            reaction: 'brilliant',
            createdAt: endsAt.toISOString(),
          },
        ],
        puzzles: [
          {
            puzzleId,
            houseId: world.first.houseId,
            seasonId,
            gameId: checkmateGame,
            prompt: 'White to play and win.',
            positionFen: fen,
            publishedAt: '2026-09-15T10:00:00.000Z',
          },
        ],
      },
      games: [
        {
          gameId: checkmateGame,
          houseId: world.first.houseId,
          seasonId,
          mode: 'correspondence',
          state: 'completed',
          color: 'black',
          result: 'white_win',
          resultReason: 'checkmate',
          plies: 7,
          createdAt: startsAt.toISOString(),
          completedAt: '2026-09-10T10:00:00.000Z',
        },
        {
          gameId: drawnGame,
          houseId: world.first.houseId,
          seasonId,
          mode: 'correspondence',
          state: 'completed',
          color: 'white',
          result: 'draw',
          resultReason: 'agreement',
          plies: 4,
          createdAt: startsAt.toISOString(),
          completedAt: '2026-09-20T10:00:00.000Z',
        },
      ],
      moves: [
        [checkmateGame, 2, 'e5', 'e7e5'],
        [checkmateGame, 4, 'Nc6', 'b8c6'],
        [checkmateGame, 6, 'Nf6', 'g8f6'],
        [drawnGame, 1, 'e4', 'e2e4'],
        [drawnGame, 3, 'Qh5', 'd1h5'],
      ].map(([gameId, ply, san, uci]) => ({
        gameId,
        houseId: world.first.houseId,
        ply,
        san,
        uci,
        playedAt: startsAt.toISOString(),
      })),
      contributions: {
        points: [
          ['game_played', 1],
          ['game_played', 1],
          ['game_draw', 2],
          ['puzzle_published', 1],
        ].map(([sourceKind, points]) => ({
          houseId: world.first.houseId,
          seasonId,
          sourceKind,
          points,
          recordedAt: createdAt.toISOString(),
        })),
        finalStandings: [
          { houseId: world.first.houseId, seasonId, rank: 1, points: 5, finalizedAt },
        ],
      },
    });
  });

  it('[BM-050] exports no other Member’s private content', async () => {
    const serialized = JSON.stringify(await accounts.exportAccount(bea().userId, exportedAt));

    for (const foreign of [
      adaNote,
      'Welcome back, everyone.',
      'well_played',
      'Ada',
      'Mira',
      'Grace',
      'Lin',
      'ada-isolation@example.test',
      'mira-isolation@example.test',
      ada().membershipId,
      world.switchingMember.firstMembershipId,
      world.second.houseId,
      bea().sessionToken,
      '203.0.113.9',
    ]) {
      expect(serialized).not.toContain(foreign);
    }

    const mira = await accounts.exportAccount(world.switchingMember.userId, exportedAt);
    expect(mira?.memberships.map((held) => [held.houseName, held.role])).toEqual([
      ['Knights at Dusk', 'steward'],
      ['The Long Table', 'member'],
    ]);
    expect(mira?.authored).toEqual({ messages: [], notes: [], reactions: [], puzzles: [] });
    expect(mira?.games.map((game) => [game.gameId, game.color])).toEqual([[drawnGame, 'black']]);
    expect(mira?.moves.map((move) => move.ply)).toEqual([2, 4]);
    expect(JSON.stringify(mira)).not.toContain(beaNote);
  });

  it('[BM-050] summarizes the active Houses a person belongs to', async () => {
    await expect(accounts.readSummary(world.switchingMember.userId)).resolves.toEqual({
      displayName: 'Mira',
      houses: [
        { houseId: world.first.houseId, name: 'Knights at Dusk', role: 'steward' },
        { houseId: world.second.houseId, name: 'The Long Table', role: 'member' },
      ],
    });
    await database.query(`update memberships set status = 'left', left_at = $2 where id = $1`, [
      world.switchingMember.secondMembershipId,
      deletedAt,
    ]);
    await expect(accounts.readSummary(world.switchingMember.userId)).resolves.toMatchObject({
      houses: [{ houseId: world.first.houseId }],
    });
    await expect(accounts.readSummary(id(5099))).resolves.toBeNull();
  });

  it('[BM-050] removes profile data and sessions, ends memberships as left, and reads Former member', async () => {
    await expect(accounts.deleteAccount(deletion(bea().userId))).resolves.toEqual({
      userId: bea().userId,
      deletedNow: true,
      membershipsLeft: 1,
      sessionsRemoved: 2,
    });

    const person = await database.query(
      `select status, deleted_at, display_name, email::text, email_verified, email_verified_at,
              image_url
         from users where id = $1`,
      [bea().userId],
    );
    expect(person.rows).toEqual([
      {
        status: 'deleted',
        deleted_at: deletedAt,
        display_name: 'Former member',
        email: `${bea().userId}@deleted.invalid`,
        email_verified: false,
        email_verified_at: null,
        image_url: null,
      },
    ]);
    const leftovers = await database.query(
      `select (select count(*)::int from sessions where user_id = $1) as bea_sessions,
              (select count(*)::int from sessions where user_id = $2) as ada_sessions,
              (select count(*)::int from accounts where user_id = $1) as bea_accounts,
              (select array_agg(identifier order by identifier) from verification) as links,
              (select count(*)::int from users where email = 'bea-isolation@example.test')
                as by_address`,
      [bea().userId, ada().userId],
    );
    expect(leftovers.rows).toEqual([
      { bea_sessions: 0, ada_sessions: 1, bea_accounts: 0, links: ['ada-link'], by_address: 0 },
    ]);

    const membership = await database.query(
      `select status, left_at, display_name_snapshot from memberships where id = $1`,
      [bea().membershipId],
    );
    expect(membership.rows).toEqual([
      { status: 'left', left_at: deletedAt, display_name_snapshot: 'Former member' },
    ]);
    const audit = await database.query(
      `select house_id::text, actor_membership_id::text, action, target_membership_id::text,
              metadata, created_at
         from membership_audit where created_at = $1`,
      [deletedAt],
    );
    expect(audit.rows).toEqual([
      {
        house_id: world.first.houseId,
        actor_membership_id: bea().membershipId,
        action: 'member_left',
        target_membership_id: bea().membershipId,
        metadata: { reason: 'account_deleted' },
        created_at: deletedAt,
      },
    ]);
    const events = await database.query<{ id: string; payload: Record<string, unknown> }>(
      'select id::text, payload from outbox_events where topic = $1 order by id',
      [NIGHT_CHAT_POSTED_TOPIC],
    );
    expect(
      events.rows.map((row) => [row.id, row.payload.authorDisplayName, row.payload.body]),
    ).toEqual([
      [beaEvent, 'Former member', 'Good luck, all.'],
      [adaEvent, 'Ada', 'Welcome back, everyone.'],
    ]);

    const reader = member(ada().userId);
    const notes = await new PgGameNoteRepository(database).readForGame(reader, checkmateGame);
    expect(notes?.notes.map((note) => [note.authorDisplayName, note.body])).toEqual([
      ['Ada', adaNote],
      ['Former member', beaNote],
    ]);
    const chat = await new PgHouseChatRepository(database).readRecent(reader, nightIds[0]);
    expect(chat?.messages.map((line) => [line.authorDisplayName, line.body])).toEqual([
      ['Former member', 'Good luck, all.'],
      ['Ada', 'Welcome back, everyone.'],
    ]);
    const board = await new PgGamePositionRepository(database).readGamePosition(
      reader,
      checkmateGame,
    );
    expect([board?.white.name, board?.black.name]).toEqual(['Ada', 'Former member']);

    // A later sign-in with the same address starts a new identity rather than the tombstone.
    await expect(
      database.query(
        `insert into users (id, display_name, email, email_verified)
         values ($1, 'Bea again', 'bea-isolation@example.test', true)`,
        [id(5098)],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('[BM-050] scrubs pending invitations for the deleted email and cancels unsent mail', async () => {
    const pending = id(5071);
    const sent = id(5072);
    const unrelated = id(5073);
    for (const [invitationId, digest, intendedEmail] of [
      [pending, 'a', 'Bea-Isolation@Example.Test'],
      [sent, 'b', 'bea-isolation@example.test'],
      [unrelated, 'c', 'ada-isolation@example.test'],
    ] as const) {
      await database.query(
        `insert into invitations
           (id, house_id, token_digest, intended_email, expires_at, use_limit,
            creator_membership_id, created_at)
         values ($1, $2, decode($3, 'hex'), $4, $5, 1, $6, $7)`,
        [
          invitationId,
          world.first.houseId,
          digest.repeat(64),
          intendedEmail,
          new Date('2099-01-01T00:00:00.000Z'),
          ada().membershipId,
          createdAt,
        ],
      );
    }
    for (const [eventId, invitationId, sentAt] of [
      [id(5081), pending, null],
      [id(5082), sent, createdAt],
      [id(5083), unrelated, null],
    ] as const) {
      await database.query(
        `insert into outbox_events
           (id, topic, aggregate_id, sequence, house_id, payload, sent_at, created_at)
         values ($1, $2, $3, 1, $4, $5, $6, $7)`,
        [
          eventId,
          INVITATION_EMAIL_TOPIC,
          invitationId,
          world.first.houseId,
          { sealed: 'encrypted-recipient-and-token' },
          sentAt,
          createdAt,
        ],
      );
    }

    await accounts.deleteAccount(deletion(bea().userId));

    const invitations = await database.query(
      `select id::text, intended_email::text, revoked_at
         from invitations where id = any($1::uuid[]) order by id`,
      [[pending, sent, unrelated]],
    );
    expect(invitations.rows).toEqual([
      { id: pending, intended_email: null, revoked_at: deletedAt },
      { id: sent, intended_email: null, revoked_at: deletedAt },
      { id: unrelated, intended_email: 'ada-isolation@example.test', revoked_at: null },
    ]);
    const events = await database.query(
      `select id::text from outbox_events
        where topic = $1 and aggregate_id = any($2::uuid[]) order by id`,
      [INVITATION_EMAIL_TOPIC, [pending, sent, unrelated]],
    );
    expect(events.rows).toEqual([{ id: id(5082) }, { id: id(5083) }]);
  });

  it('[BM-050] waits for an Invitation email send before deleting its recipient', async () => {
    const invitationId = id(5074);
    await database.query(
      `insert into invitations
         (id, house_id, token_digest, intended_email, expires_at, use_limit,
          creator_membership_id, created_at)
       values ($1, $2, decode($3, 'hex'), $4, $5, 1, $6, $7)`,
      [
        invitationId,
        world.first.houseId,
        'd'.repeat(64),
        'bea-isolation@example.test',
        new Date('2099-01-01T00:00:00.000Z'),
        ada().membershipId,
        createdAt,
      ],
    );
    const gate = new PgInvitationEmailDeliveryGate(database);
    let sendStarted!: () => void;
    let finishSend!: () => void;
    const sending = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    const delivery = gate.withDeliverableInvitation(invitationId, async () => {
      sendStarted();
      await finished;
      return 'sent';
    });
    await sending;
    const deleting = accounts.deleteAccount(deletion(bea().userId));
    deleting.catch(() => undefined);
    try {
      await untilBlocked();
      const person = await database.query('select status from users where id = $1', [bea().userId]);
      expect(person.rows).toEqual([{ status: 'active' }]);
    } finally {
      finishSend();
    }
    await expect(delivery).resolves.toBe('sent');
    await expect(deleting).resolves.toMatchObject({ deletedNow: true });
    let called = false;
    await expect(
      gate.withDeliverableInvitation(invitationId, async () => {
        called = true;
        return 'sent';
      }),
    ).resolves.toBeNull();
    expect(called).toBe(false);
  });

  it('[BM-030] skips missing, revoked, and shared Invitations before sending email', async () => {
    const shared = id(5075);
    const revoked = id(5076);
    for (const [invitationId, digest, intendedEmail, revokedAt] of [
      [shared, 'e', null, null],
      [revoked, 'f', 'bea-isolation@example.test', deletedAt],
    ] as const) {
      await database.query(
        `insert into invitations
           (id, house_id, token_digest, intended_email, expires_at, use_limit,
            revoked_at, creator_membership_id, created_at)
         values ($1, $2, decode($3, 'hex'), $4, $5, 1, $6, $7, $8)`,
        [
          invitationId,
          world.first.houseId,
          digest.repeat(64),
          intendedEmail,
          new Date('2099-01-01T00:00:00.000Z'),
          revokedAt,
          ada().membershipId,
          createdAt,
        ],
      );
    }
    const gate = new PgInvitationEmailDeliveryGate(database);
    let sends = 0;
    for (const invitationId of [id(5077), shared, revoked]) {
      await expect(
        gate.withDeliverableInvitation(invitationId, async () => {
          sends += 1;
          return 'sent';
        }),
      ).resolves.toBeNull();
    }
    expect(sends).toBe(0);
  });

  it('[BM-050] keeps Games, Moves, scores, and the published Closing Book intact', async () => {
    const before = await sharedRecords();
    await accounts.deleteAccount(deletion(bea().userId));

    expect(await sharedRecords()).toEqual(before);
    const shelf = await books.readLatest(member(ada().userId));
    const contents = shelf?.book?.contents;
    expect(
      contents?.participation.map((entry) => [entry.displayName, entry.rank, entry.points]),
    ).toEqual([
      ['Former member', 1, 5],
      ['Ada', 2, 4],
      ['Mira', 3, 3],
    ]);
    expect(contents?.games.map((game) => [game.white.displayName, game.black.displayName])).toEqual(
      [
        ['Ada', 'Former member'],
        ['Former member', 'Mira'],
      ],
    );
    expect(contents?.puzzles.map((puzzle) => puzzle.contributor.displayName)).toEqual([
      'Former member',
    ]);
    expect(JSON.stringify(contents)).not.toContain('"Bea"');
    expect(contents?.totals).toEqual(before.books[0]?.payload.totals);
  });

  it('[BM-050] ends every active membership across Houses and keeps earlier departures', async () => {
    const removedAt = new Date('2026-09-30T09:00:00.000Z');
    await database.query(`update memberships set status = 'removed', left_at = $2 where id = $1`, [
      world.switchingMember.secondMembershipId,
      removedAt,
    ]);

    await expect(accounts.deleteAccount(deletion(world.switchingMember.userId))).resolves.toEqual({
      userId: world.switchingMember.userId,
      deletedNow: true,
      membershipsLeft: 1,
      sessionsRemoved: 0,
    });
    const held = await database.query(
      `select id::text, status, left_at, display_name_snapshot
         from memberships where user_id = $1 order by id`,
      [world.switchingMember.userId],
    );
    expect(held.rows).toEqual([
      {
        id: world.switchingMember.firstMembershipId,
        status: 'left',
        left_at: deletedAt,
        display_name_snapshot: 'Former member',
      },
      {
        id: world.switchingMember.secondMembershipId,
        status: 'removed',
        left_at: removedAt,
        display_name_snapshot: 'Former member',
      },
    ]);
    const audits = await database.query(
      `select house_id::text from membership_audit where created_at = $1`,
      [deletedAt],
    );
    expect(audits.rows).toEqual([{ house_id: world.first.houseId }]);
  });

  it('[BM-050] refuses to delete an Owner until ownership is transferred, changing nothing', async () => {
    const before = await database.query(
      `select u.status, u.email::text, m.status as membership_status,
              (select count(*)::int from sessions s where s.user_id = u.id) as sessions
         from users u join memberships m on m.user_id = u.id where u.id = $1`,
      [ada().userId],
    );

    const refused = accounts.deleteAccount(deletion(ada().userId));
    await expect(refused).rejects.toBeInstanceOf(AccountDeletionBlockedError);
    await expect(refused).rejects.toMatchObject({
      code: 'conflict',
      ownedHouses: [{ houseId: world.first.houseId, name: 'Knights at Dusk' }],
    });
    const after = await database.query(
      `select u.status, u.email::text, m.status as membership_status,
              (select count(*)::int from sessions s where s.user_id = u.id) as sessions
         from users u join memberships m on m.user_id = u.id where u.id = $1`,
      [ada().userId],
    );
    expect(after.rows).toEqual(before.rows);
    const audits = await database.query('select 1 from membership_audit where created_at = $1', [
      deletedAt,
    ]);
    expect(audits.rowCount).toBe(0);
  });

  it('[BM-050] makes deletion irreversible and replays a repeated request', async () => {
    await accounts.deleteAccount(deletion(bea().userId));

    await expect(accounts.deleteAccount(deletion(bea().userId))).resolves.toEqual({
      userId: bea().userId,
      deletedNow: false,
      membershipsLeft: 0,
      sessionsRemoved: 0,
    });
    await expect(accounts.exportAccount(bea().userId, exportedAt)).resolves.toBeNull();
    await expect(accounts.readSummary(bea().userId)).resolves.toBeNull();
    await expect(
      database.query(`update users set status = 'active', deleted_at = null where id = $1`, [
        bea().userId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.query(`update users set display_name = 'Bea' where id = $1`, [bea().userId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.query(
        `insert into sessions (id, user_id, token, expires_at)
         values ($1, $2, 'bm-050-resurrected-session-token-00001', '2099-01-01')`,
        [id(5097), bea().userId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.query(`update memberships set status = 'active', left_at = null where id = $1`, [
        bea().membershipId,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  /** Wait until another connection is queued behind a row lock. */
  async function untilBlocked(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await database.query(
        `select 1 from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
      );
      if (waiting.rowCount !== 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Expected a connection to wait on a row lock');
  }

  const lateSession = (userId: string) =>
    database.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, 'bm-050-late-sign-in-session-token-0001', '2099-01-01')`,
      [id(5095), userId],
    );

  it('[BM-050] rejects a sign-in that races an in-flight deletion', async () => {
    const deleter = await database.connect();
    try {
      await deleter.query('begin');
      await deleter.query('select 1 from users where id = $1 for update', [bea().userId]);
      const signingIn = lateSession(bea().userId);
      signingIn.catch(() => undefined);
      await untilBlocked();
      await deleter.query('delete from sessions where user_id = $1', [bea().userId]);
      await deleter.query(
        `update users
            set status = 'deleted', deleted_at = $2, display_name = 'Former member',
                email = id::text || '@deleted.invalid', email_verified = false,
                email_verified_at = null, image_url = null
          where id = $1`,
        [bea().userId, deletedAt],
      );
      await deleter.query('commit');

      await expect(signingIn).rejects.toMatchObject({ code: '55000' });
    } finally {
      deleter.release();
    }
    const sessions = await database.query('select 1 from sessions where user_id = $1', [
      bea().userId,
    ]);
    expect(sessions.rowCount).toBe(0);
  });

  it('[BM-050] waits for a sign-in already under way, then removes its session too', async () => {
    const signingIn = await database.connect();
    let deleting: Promise<unknown>;
    try {
      await signingIn.query('begin');
      await signingIn.query(
        `insert into sessions (id, user_id, token, expires_at)
         values ($1, $2, 'bm-050-late-sign-in-session-token-0001', '2099-01-01')`,
        [id(5095), bea().userId],
      );
      deleting = accounts.deleteAccount(deletion(bea().userId));
      await untilBlocked();
      await signingIn.query('commit');
    } finally {
      signingIn.release();
    }

    await expect(deleting).resolves.toMatchObject({ deletedNow: true, sessionsRemoved: 3 });
    const sessions = await database.query('select 1 from sessions where user_id = $1', [
      bea().userId,
    ]);
    expect(sessions.rowCount).toBe(0);
  });

  it('[BM-050] turns an identity already marked deleted into a tombstone when migrating', async () => {
    // roll back to just before 0026, like the nudge migration test, so newer migrations can land
    const reverted: string[] = [];
    for (;;) {
      const [name] = await migrateDown(database, { migrationsDirectory });
      if (name === undefined) throw new Error('0026_account_deletion was not applied');
      reverted.push(name);
      if (name === '0026_account_deletion') break;
    }
    await database.query(`update users set status = 'deleted', deleted_at = null where id = $1`, [
      bea().userId,
    ]);

    await expect(migrateUp(database, { migrationsDirectory })).resolves.toEqual(
      [...reverted].reverse(),
    );
    const person = await database.query(
      `select display_name, email::text, email_verified, image_url, deleted_at is not null as dated
         from users where id = $1`,
      [bea().userId],
    );
    expect(person.rows).toEqual([
      {
        display_name: 'Former member',
        email: `${bea().userId}@deleted.invalid`,
        email_verified: false,
        image_url: null,
        dated: true,
      },
    ]);
    const others = await database.query(
      `select count(*)::int as active from users where status = 'active'`,
    );
    expect(others.rows).toEqual([{ active: 4 }]);
  });

  it('[BM-050] reports an unknown account as not found', async () => {
    const missing = accounts.deleteAccount(deletion(id(5096)));
    await expect(missing).rejects.toBeInstanceOf(DomainError);
    await expect(missing).rejects.toMatchObject({ code: 'not_found' });
    await expect(accounts.exportAccount(id(5096), exportedAt)).resolves.toBeNull();
  });
});
