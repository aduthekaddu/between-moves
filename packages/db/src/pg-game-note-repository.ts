import {
  DomainError,
  type AuthorizationContext,
  type GameNote,
  type GameNoteRepository,
  type GameNotesView,
  type SaveGameNoteInput,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface NoteRow extends QueryResultRow {
  readonly current_membership_id?: unknown;
  readonly membership_id: unknown;
  readonly author_display_name: unknown;
  readonly body: unknown;
  readonly created_at: unknown;
  readonly edited_at: unknown;
}

function parseDate(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Game note ${label}`);
  return parsed;
}

function parseNote(row: NoteRow): GameNote {
  if (
    typeof row.membership_id !== 'string' ||
    typeof row.author_display_name !== 'string' ||
    typeof row.body !== 'string'
  ) {
    throw new Error('Invalid Game note row');
  }
  return {
    membershipId: row.membership_id,
    authorDisplayName: row.author_display_name,
    body: row.body,
    createdAt: parseDate(row.created_at, 'created timestamp'),
    editedAt: row.edited_at === null ? null : parseDate(row.edited_at, 'edited timestamp'),
  };
}

/** [BM-032] [DR-NOTE-01] PostgreSQL-enforced one-note-per-Member persistence. */
export class PgGameNoteRepository implements GameNoteRepository {
  constructor(private readonly database: Pool) {}

  async save(context: AuthorizationContext, input: SaveGameNoteInput): Promise<GameNote> {
    const result = await this.database.query<NoteRow>(
      `with saved as (
         insert into game_notes (id, game_id, house_id, membership_id, body, created_at)
         select $4, g.id, g.house_id, actor.id, $5, $6
           from games g
           join memberships actor
             on actor.house_id = g.house_id
            and actor.user_id = $3
            and actor.status = 'active'
          where g.house_id = $1 and g.id = $2 and g.state = 'completed'
         on conflict (game_id, membership_id)
         do update set body = excluded.body, edited_at = excluded.created_at
         returning membership_id, body, created_at, edited_at
       )
       select saved.membership_id::text,
              case when author.status = 'active' then person.display_name else 'Former member' end
                as author_display_name,
              saved.body, saved.created_at, saved.edited_at
         from saved
         join memberships author on author.id = saved.membership_id
         join users person on person.id = author.user_id`,
      [context.houseId, input.gameId, context.viewerId, input.id, input.body, input.savedAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'The completed Game is unavailable');
    return parseNote(row);
  }

  async readForGame(context: AuthorizationContext, gameId: string): Promise<GameNotesView | null> {
    const result = await this.database.query<NoteRow>(
      `with scope as (
         select actor.id as current_membership_id
           from games g
           join memberships actor
             on actor.house_id = g.house_id
            and actor.user_id = $3
            and actor.status = 'active'
          where g.house_id = $1 and g.id = $2 and g.state = 'completed'
       )
       select scope.current_membership_id::text,
              note.membership_id::text,
              case when author.status = 'active' then person.display_name else 'Former member' end
                as author_display_name,
              note.body, note.created_at, note.edited_at
         from scope
         left join game_notes note on note.house_id = $1 and note.game_id = $2
         left join memberships author on author.id = note.membership_id
         left join users person on person.id = author.user_id
        order by note.created_at, note.membership_id`,
      [context.houseId, gameId, context.viewerId],
    );
    const first = result.rows[0];
    if (first === undefined) return null;
    if (typeof first.current_membership_id !== 'string') {
      throw new Error('Invalid current Game note membership');
    }
    return {
      currentMembershipId: first.current_membership_id,
      notes: result.rows.filter((row) => row.membership_id !== null).map(parseNote),
    };
  }
}
