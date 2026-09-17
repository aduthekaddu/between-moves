import type {
  AuthorizationContext,
  NightRealtimeScope,
  NightRealtimeScopeRepository,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface NightRealtimeScopeRow extends QueryResultRow {
  readonly house_id: unknown;
  readonly night_id: unknown;
  readonly game_ids: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Night realtime scope ${field}`);
  return value;
}

function gameIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Invalid Night realtime scope game ids');
  return value.map((id) => text(id, 'game id'));
}

/** [BM-037] [DR-SEC-01] Authorized Night read plus the Game IDs that share its channels. */
export class PgNightRealtimeScopeRepository implements NightRealtimeScopeRepository {
  constructor(private readonly database: Pool) {}

  async read(context: AuthorizationContext, nightId: string): Promise<NightRealtimeScope | null> {
    const result = await this.database.query<NightRealtimeScopeRow>(
      `select n.house_id::text as house_id, n.id::text as night_id,
              coalesce(
                (select json_agg(g.id::text order by g.id)
                   from games g
                  where g.night_id = n.id and g.house_id = n.house_id),
                '[]'::json
              ) as game_ids
         from house_nights n
         join seasons s
           on s.id = n.season_id and s.house_id = n.house_id
          and s.state in ('active', 'closing')
         join houses h on h.id = n.house_id and h.status = 'active'
         join memberships m
           on m.house_id = n.house_id
          and m.user_id = $3
          and m.status = 'active'
        where n.id = $1 and n.house_id = $2 and n.state <> 'cancelled'`,
      [nightId, context.houseId, context.viewerId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      houseId: text(row.house_id, 'House id'),
      nightId: text(row.night_id, 'Night id'),
      gameIds: gameIds(row.game_ids),
    };
  }
}
