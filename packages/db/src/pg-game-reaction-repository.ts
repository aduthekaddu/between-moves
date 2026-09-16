import {
  DomainError,
  type AuthorizationContext,
  type GameReaction,
  type GameReactionRepository,
  type GameReactionValue,
  type SetGameReactionInput,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface ReactionRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly reaction: unknown;
  readonly created_at: unknown;
}

function parseReaction(value: unknown): GameReactionValue {
  if (
    value === 'well_played' ||
    value === 'brilliant' ||
    value === 'dramatic' ||
    value === 'funny'
  ) {
    return value;
  }
  throw new Error('Invalid Game Reaction value');
}

function parseDate(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid Game Reaction timestamp');
  return parsed;
}

/** [BM-031] [DR-REACT-01] PostgreSQL-enforced current-Reaction upsert. */
export class PgGameReactionRepository implements GameReactionRepository {
  constructor(private readonly database: Pool) {}

  async set(context: AuthorizationContext, input: SetGameReactionInput): Promise<GameReaction> {
    const result = await this.database.query<ReactionRow>(
      `insert into game_reactions (id, game_id, house_id, membership_id, reaction, created_at)
       select $4, g.id, g.house_id, m.id, $5, $6
         from games g
         join memberships m
           on m.house_id = g.house_id and m.user_id = $3 and m.status = 'active'
        where g.house_id = $1 and g.id = $2 and g.state = 'completed'
       on conflict (game_id, membership_id)
       do update set reaction = excluded.reaction, created_at = excluded.created_at
       returning membership_id::text, reaction, created_at`,
      [context.houseId, input.gameId, context.viewerId, input.id, input.reaction, input.reactedAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'The completed Game is unavailable');
    if (typeof row.membership_id !== 'string') {
      throw new Error('Invalid Game Reaction membership id');
    }
    return {
      membershipId: row.membership_id,
      reaction: parseReaction(row.reaction),
      reactedAt: parseDate(row.created_at),
    };
  }

  async readCurrent(
    context: AuthorizationContext,
    gameId: string,
  ): Promise<GameReactionValue | null> {
    const result = await this.database.query<ReactionRow>(
      `select r.membership_id::text, r.reaction, r.created_at
         from game_reactions r
         join games g
           on g.id = r.game_id and g.house_id = r.house_id and g.state = 'completed'
         join memberships m
           on m.id = r.membership_id and m.house_id = r.house_id
          and m.user_id = $3 and m.status = 'active'
        where r.house_id = $1 and r.game_id = $2`,
      [context.houseId, gameId, context.viewerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseReaction(row.reaction);
  }
}
