import {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
  AccountDeletionBlockedError,
  DomainError,
  FORMER_MEMBER_DISPLAY_NAME,
  GAME_REACTIONS,
  INVITATION_EMAIL_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  type AccountDataRightsRepository,
  type AccountDeletionInput,
  type AccountDeletionResult,
  type AccountExport,
  type AccountExportMembership,
  type AccountSummary,
  type GameReactionValue,
  type MembershipRole,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  asMembershipAdminTransactionError,
  rollbackMembershipAdminTransaction,
} from './pg-membership-admin-support';

type Row = QueryResultRow & Readonly<Record<string, unknown>>;

const MEMBERSHIP_ROLES = new Set(['owner', 'steward', 'member']);
const MEMBERSHIP_STATUSES = new Set(['active', 'left', 'removed']);
const GAME_MODES = new Set(['correspondence', 'live']);
const GAME_STATES = new Set(['waiting', 'active', 'completed', 'cancelled']);
const REACTIONS = new Set<string>(GAME_REACTIONS);
const COLORS = new Set(['white', 'black']);

/** Return a string unchanged, or throw an Error naming the invalid field. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid account ${field}`);
  return value;
}

/** Return a string or null unchanged, or throw an Error naming the invalid field. */
function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

/** Return an integer unchanged, or throw an Error naming the invalid field. */
function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid account ${field}`);
  }
  return value;
}

/** Return a valid instant as an ISO string, or throw an Error naming the invalid field. */
function instant(value: unknown, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid account ${field}`);
  }
  return value.toISOString();
}

/** Return an optional instant as an ISO string or null. */
function optionalInstant(value: unknown, field: string): string | null {
  return value === null ? null : instant(value, field);
}

/** Return a value from an allowed set, or throw an Error naming the invalid field. */
function oneOf<T extends string>(value: unknown, allowed: ReadonlySet<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`Invalid account ${field}`);
  }
  return value as T;
}

/** Run reads in one repeatable-read, read-only transaction so they share a snapshot. */
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

/** Run one query for rows authored through any of the person's memberships. */
async function rows(client: PoolClient, sql: string, userId: string): Promise<readonly Row[]> {
  return (await client.query<Row>(sql, [userId])).rows;
}

/** Every membership the person has held, in the order they joined. */
async function memberships(
  client: PoolClient,
  userId: string,
): Promise<readonly AccountExportMembership[]> {
  const result = await rows(
    client,
    `select m.id::text, m.house_id::text, h.name, m.role, m.status, m.joined_at, m.left_at
       from memberships m
       join houses h on h.id = m.house_id
      where m.user_id = $1
      order by m.joined_at, m.id`,
    userId,
  );
  return result.map((row) => ({
    membershipId: text(row.id, 'membership id'),
    houseId: text(row.house_id, 'membership House'),
    houseName: text(row.name, 'membership House name'),
    role: oneOf<MembershipRole>(row.role, MEMBERSHIP_ROLES, 'membership role'),
    status: oneOf<AccountExportMembership['status']>(
      row.status,
      MEMBERSHIP_STATUSES,
      'membership status',
    ),
    joinedAt: instant(row.joined_at, 'membership join'),
    leftAt: optionalInstant(row.left_at, 'membership departure'),
  }));
}

/**
 * The person's own records, joined through their memberships so a row written by any other
 * Member can never be selected.
 */
async function ownRecords(client: PoolClient, userId: string) {
  const [messages, notes, reactions, puzzles, games, moves, points, standings] = [
    await rows(
      client,
      `select msg.id::text, msg.house_id::text, msg.night_id::text, msg.body, msg.created_at,
              msg.deleted_at
         from house_messages msg
         join memberships m on m.id = msg.membership_id and m.house_id = msg.house_id
        where m.user_id = $1
        order by msg.created_at, msg.id`,
      userId,
    ),
    await rows(
      client,
      `select n.id::text, n.house_id::text, n.game_id::text, n.body, n.created_at, n.edited_at
         from game_notes n
         join memberships m on m.id = n.membership_id and m.house_id = n.house_id
        where m.user_id = $1
        order by n.created_at, n.id`,
      userId,
    ),
    await rows(
      client,
      `select r.house_id::text, r.game_id::text, r.reaction, r.created_at
         from game_reactions r
         join memberships m on m.id = r.membership_id and m.house_id = r.house_id
        where m.user_id = $1
        order by r.created_at, r.id`,
      userId,
    ),
    await rows(
      client,
      `select p.id::text, p.house_id::text, p.season_id::text, p.game_id::text, p.prompt,
              p.position_fen, p.published_at
         from house_puzzles p
         join memberships m on m.id = p.contributor_membership_id and m.house_id = p.house_id
        where m.user_id = $1
        order by p.published_at, p.id`,
      userId,
    ),
    await rows(
      client,
      `select g.id::text, g.house_id::text, g.season_id::text, g.mode, g.state,
              case when g.white_membership_id = m.id then 'white' else 'black' end as color,
              g.result, g.result_reason, g.current_ply, g.created_at, g.completed_at
         from games g
         join memberships m
           on m.house_id = g.house_id and m.id in (g.white_membership_id, g.black_membership_id)
        where m.user_id = $1
        order by g.created_at, g.id`,
      userId,
    ),
    await rows(
      client,
      `select mv.game_id::text, mv.house_id::text, mv.ply, mv.san, mv.uci, mv.server_received_at
         from moves mv
         join memberships m on m.id = mv.actor_membership_id and m.house_id = mv.house_id
        where m.user_id = $1
        order by mv.server_received_at, mv.game_id, mv.ply`,
      userId,
    ),
    await rows(
      client,
      `select l.house_id::text, l.season_id::text, l.source_kind, l.points, l.created_at
         from season_score_ledger l
         join memberships m on m.id = l.membership_id and m.house_id = l.house_id
        where m.user_id = $1
        order by l.created_at, l.id`,
      userId,
    ),
    await rows(
      client,
      `select f.house_id::text, f.season_id::text, f.rank, f.points, f.finalized_at
         from season_final_standings f
         join memberships m on m.id = f.membership_id and m.house_id = f.house_id
        where m.user_id = $1
        order by f.finalized_at, f.season_id`,
      userId,
    ),
  ];
  return {
    authored: {
      messages: messages.map((row) => ({
        messageId: text(row.id, 'message id'),
        houseId: text(row.house_id, 'message House'),
        nightId: text(row.night_id, 'message Night'),
        body: text(row.body, 'message body'),
        sentAt: instant(row.created_at, 'message time'),
        removedAt: optionalInstant(row.deleted_at, 'message removal'),
      })),
      notes: notes.map((row) => ({
        noteId: text(row.id, 'note id'),
        houseId: text(row.house_id, 'note House'),
        gameId: text(row.game_id, 'note Game'),
        body: text(row.body, 'note body'),
        createdAt: instant(row.created_at, 'note time'),
        editedAt: optionalInstant(row.edited_at, 'note edit'),
      })),
      reactions: reactions.map((row) => ({
        houseId: text(row.house_id, 'reaction House'),
        gameId: text(row.game_id, 'reaction Game'),
        reaction: oneOf<GameReactionValue>(row.reaction, REACTIONS, 'reaction'),
        createdAt: instant(row.created_at, 'reaction time'),
      })),
      puzzles: puzzles.map((row) => ({
        puzzleId: text(row.id, 'Puzzle id'),
        houseId: text(row.house_id, 'Puzzle House'),
        seasonId: text(row.season_id, 'Puzzle Season'),
        gameId: text(row.game_id, 'Puzzle Game'),
        prompt: text(row.prompt, 'Puzzle prompt'),
        positionFen: text(row.position_fen, 'Puzzle position'),
        publishedAt: instant(row.published_at, 'Puzzle publication'),
      })),
    },
    games: games.map((row) => ({
      gameId: text(row.id, 'Game id'),
      houseId: text(row.house_id, 'Game House'),
      seasonId: text(row.season_id, 'Game Season'),
      mode: oneOf<'correspondence' | 'live'>(row.mode, GAME_MODES, 'Game mode'),
      state: oneOf<'waiting' | 'active' | 'completed' | 'cancelled'>(
        row.state,
        GAME_STATES,
        'Game state',
      ),
      color: oneOf<'white' | 'black'>(row.color, COLORS, 'Game color'),
      result: optionalText(row.result, 'Game result'),
      resultReason: optionalText(row.result_reason, 'Game result reason'),
      plies: integer(row.current_ply, 'Game plies'),
      createdAt: instant(row.created_at, 'Game creation'),
      completedAt: optionalInstant(row.completed_at, 'Game completion'),
    })),
    moves: moves.map((row) => ({
      gameId: text(row.game_id, 'Move Game'),
      houseId: text(row.house_id, 'Move House'),
      ply: integer(row.ply, 'Move ply'),
      san: text(row.san, 'Move SAN'),
      uci: text(row.uci, 'Move UCI'),
      playedAt: instant(row.server_received_at, 'Move time'),
    })),
    contributions: {
      points: points.map((row) => ({
        houseId: text(row.house_id, 'points House'),
        seasonId: text(row.season_id, 'points Season'),
        sourceKind: text(row.source_kind, 'points source'),
        points: integer(row.points, 'points'),
        recordedAt: instant(row.created_at, 'points time'),
      })),
      finalStandings: standings.map((row) => ({
        houseId: text(row.house_id, 'standing House'),
        seasonId: text(row.season_id, 'standing Season'),
        rank: integer(row.rank, 'standing rank'),
        points: integer(row.points, 'standing points'),
        finalizedAt: instant(row.finalized_at, 'standing time'),
      })),
    },
  };
}

interface DeletionMembershipRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly house_name: unknown;
  readonly house_status: unknown;
  readonly role: unknown;
  readonly status: unknown;
}

/**
 * The needle Better Auth's magic-link verification value holds for an address:
 * `JSON.stringify({ email, name })`, compared case-insensitively.
 */
function magicLinkEmailNeedle(email: string): string {
  return `"email":${JSON.stringify(email.toLowerCase())}`;
}

/**
 * [BM-050] PostgreSQL authority for a person's own data rights: a self-scoped export and an
 * irreversible deletion that keeps the House's shared history.
 */
export class PgAccountDataRightsRepository implements AccountDataRightsRepository {
  constructor(private readonly database: Pool) {}

  async readSummary(userId: string): Promise<AccountSummary | null> {
    const result = await this.database.query<Row>(
      `select u.display_name, m.house_id::text, h.name, m.role
         from users u
         left join memberships m on m.user_id = u.id and m.status = 'active'
         left join houses h on h.id = m.house_id and h.status = 'active'
        where u.id = $1 and u.status = 'active'
        order by h.name, h.id`,
      [userId],
    );
    const first = result.rows[0];
    if (first === undefined) return null;
    return {
      displayName: text(first.display_name, 'display name'),
      houses: result.rows
        .filter((row) => row.name !== null)
        .map((row) => ({
          houseId: text(row.house_id, 'House id'),
          name: text(row.name, 'House name'),
          role: oneOf<MembershipRole>(row.role, MEMBERSHIP_ROLES, 'membership role'),
        })),
    };
  }

  async exportAccount(userId: string, exportedAt: Date): Promise<AccountExport | null> {
    return readOnlySnapshot(this.database, async (client) => {
      const profile = await client.query<Row>(
        `select id::text, display_name, email::text, email_verified, image_url, created_at
           from users
          where id = $1 and status = 'active'`,
        [userId],
      );
      const row = profile.rows[0];
      if (row === undefined) return null;
      if (typeof row.email_verified !== 'boolean') throw new Error('Invalid account verification');
      return {
        format: ACCOUNT_EXPORT_FORMAT,
        version: ACCOUNT_EXPORT_VERSION,
        exportedAt: exportedAt.toISOString(),
        profile: {
          userId: text(row.id, 'id'),
          displayName: text(row.display_name, 'display name'),
          email: text(row.email, 'email'),
          emailVerified: row.email_verified,
          imageUrl: optionalText(row.image_url, 'image'),
          createdAt: instant(row.created_at, 'creation'),
        },
        memberships: await memberships(client, userId),
        ...(await ownRecords(client, userId)),
      };
    });
  }

  async deleteAccount(input: AccountDeletionInput): Promise<AccountDeletionResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const user = await client.query<Row>(
        `select status, email::text from users where id = $1 for update`,
        [input.userId],
      );
      const person = user.rows[0];
      if (person === undefined) throw new DomainError('not_found', 'Account is unavailable');
      if (person.status === 'deleted') {
        await client.query('commit');
        return { userId: input.userId, deletedNow: false, membershipsLeft: 0, sessionsRemoved: 0 };
      }
      const email = text(person.email, 'email');

      const held = await client.query<DeletionMembershipRow>(
        `select m.id::text, m.house_id::text, m.role, m.status,
                h.name as house_name, h.status as house_status
           from memberships m
           join houses h on h.id = m.house_id
          where m.user_id = $1
          order by h.name, h.id
          for update of m`,
        [input.userId],
      );
      const owned = held.rows.filter(
        (row) => row.status === 'active' && row.role === 'owner' && row.house_status === 'active',
      );
      if (owned.length > 0) {
        throw new AccountDeletionBlockedError(
          owned.map((row) => ({
            houseId: text(row.house_id, 'owned House'),
            name: text(row.house_name, 'owned House name'),
          })),
        );
      }
      const ending = held.rows.filter((row) => row.status === 'active');
      const membershipIds = held.rows.map((row) => text(row.id, 'membership id'));

      await client.query(
        `update memberships
            set display_name_snapshot = $3,
                status = case when status = 'active' then 'left' else status end,
                left_at = case when status = 'active' then $2 else left_at end,
                updated_at = $2
          where user_id = $1`,
        [input.userId, input.deletedAt, FORMER_MEMBER_DISPLAY_NAME],
      );
      if (ending.length > 0) {
        await client.query(
          `insert into membership_audit
             (id, house_id, actor_membership_id, action, target_membership_id, metadata,
              created_at)
           select audit.id, audit.house_id, audit.membership_id, 'member_left',
                  audit.membership_id, '{"reason":"account_deleted"}'::jsonb, $4
             from unnest($1::uuid[], $2::uuid[], $3::uuid[])
               as audit(id, house_id, membership_id)`,
          [
            ending.map(() => input.auditIds.generate()),
            ending.map((row) => text(row.house_id, 'membership House')),
            ending.map((row) => text(row.id, 'membership id')),
            input.deletedAt,
          ],
        );
      }
      // Chat realtime events copied the author's name when they were posted.
      await client.query(
        `update outbox_events
            set payload = jsonb_set(payload, '{authorDisplayName}', to_jsonb($3::text))
          where topic = $1
            and payload ->> 'membershipId' = any($2::text[])
            and payload ? 'authorDisplayName'`,
        [NIGHT_CHAT_POSTED_TOPIC, membershipIds, FORMER_MEMBER_DISPLAY_NAME],
      );
      const sessions = await client.query('delete from sessions where user_id = $1', [
        input.userId,
      ]);
      await client.query('delete from accounts where user_id = $1', [input.userId]);
      await client.query(`delete from verification where strpos(lower(value), $1) > 0`, [
        magicLinkEmailNeedle(email),
      ]);
      await client.query(
        `with scrubbed as (
           update invitations
              set intended_email = null, revoked_at = $2
            where intended_email = $1::citext
              and revoked_at is null
              and use_count < use_limit
          returning id
         )
         delete from outbox_events
          where topic = $3
            and aggregate_id in (select id from scrubbed)
            and sent_at is null`,
        [email.trim().toLowerCase(), input.deletedAt, INVITATION_EMAIL_TOPIC],
      );
      await client.query(
        `update users
            set status = 'deleted',
                deleted_at = $2,
                display_name = $3,
                email = id::text || '@deleted.invalid',
                email_verified = false,
                email_verified_at = null,
                image_url = null,
                updated_at = $2
          where id = $1`,
        [input.userId, input.deletedAt, FORMER_MEMBER_DISPLAY_NAME],
      );
      await client.query('commit');
      return {
        userId: input.userId,
        deletedNow: true,
        membershipsLeft: ending.length,
        sessionsRemoved: sessions.rowCount ?? 0,
      };
    } catch (error) {
      await rollbackMembershipAdminTransaction(client);
      throw asMembershipAdminTransactionError(error);
    } finally {
      client.release();
    }
  }
}
