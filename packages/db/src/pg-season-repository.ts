import {
  DomainError,
  type AuthorizationContext,
  type CharterDraftInput,
  type CharterDraftResult,
  type SeasonDraftInput,
  type SeasonDraftResult,
  type SeasonPublishInput,
  type SeasonPublishResult,
  type SeasonRepository,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface SeasonRow extends QueryResultRow {
  readonly state: unknown;
  readonly published_charter_version: unknown;
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Season ${field}`);
  }
  return value;
}

function isActiveSeasonConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'seasons_one_active_or_closing_per_house'
  );
}

async function authorizedHouse(client: PoolClient, context: AuthorizationContext): Promise<void> {
  const result = await client.query(
    `select h.id
       from houses h
       join memberships m
         on m.house_id = h.id
        and m.user_id = $2
        and m.status = 'active'
        and m.role in ('owner', 'steward')
      where h.id = $1 and h.status = 'active'
      for update of h`,
    [context.houseId, context.viewerId],
  );
  if (result.rowCount !== 1) throw new DomainError('not_found', 'Season is unavailable');
}

async function authorizedSeason(
  client: PoolClient,
  context: AuthorizationContext,
  seasonId: string,
): Promise<SeasonRow> {
  const result = await client.query<SeasonRow>(
    `select s.state, s.published_charter_version
       from seasons s
       join memberships m
         on m.house_id = s.house_id
        and m.user_id = $3
        and m.status = 'active'
        and m.role in ('owner', 'steward')
      where s.id = $1 and s.house_id = $2
      for update of s`,
    [seasonId, context.houseId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Season is unavailable');
  return row;
}

async function inTransaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (isActiveSeasonConflict(error)) {
      throw new DomainError('conflict', 'House already has an active or closing Season', {
        cause: error,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** [BM-018] [DR-SEASON-01..05] PostgreSQL Season and Charter transaction authority. */
export class PgSeasonRepository implements SeasonRepository {
  constructor(private readonly database: Pool) {}

  async draft(context: AuthorizationContext, input: SeasonDraftInput): Promise<SeasonDraftResult> {
    return inTransaction(this.database, async (client) => {
      await authorizedHouse(client, context);
      const current = await client.query(
        `select 1 from seasons
          where house_id = $1 and state in ('active', 'closing')
          limit 1`,
        [context.houseId],
      );
      if (current.rowCount !== 0) {
        throw new DomainError('conflict', 'House already has an active or closing Season');
      }
      await client.query(
        `insert into seasons
          (id, house_id, title, state, created_at, updated_at)
         values ($1, $2, $3, 'draft', $4, $4)`,
        [input.seasonId, context.houseId, input.title, input.createdAt],
      );
      return { seasonId: input.seasonId, houseId: context.houseId, state: 'draft' };
    });
  }

  async draftCharter(
    context: AuthorizationContext,
    input: CharterDraftInput,
  ): Promise<CharterDraftResult> {
    return inTransaction(this.database, async (client) => {
      const season = await authorizedSeason(client, context, input.seasonId);
      if (season.state !== 'draft') {
        throw new DomainError('conflict', 'A Charter can be drafted only for a draft Season');
      }
      const latest = await client.query<{ version: number }>(
        `select coalesce(max(version), 0)::integer as version
           from season_charters
          where season_id = $1`,
        [input.seasonId],
      );
      const version = parseInteger(latest.rows[0]?.version, 'Charter version') + 1;
      await client.query(
        `insert into season_charters
          (id, season_id, version, correspondence_pace_hours, night_recurrence,
           points_recipe, published_at, created_at)
         values ($1, $2, $3, $4, $5, $6, null, $7)`,
        [
          input.charterId,
          input.seasonId,
          version,
          input.correspondencePaceHours,
          input.nightRecurrence,
          input.pointsRecipe,
          input.createdAt,
        ],
      );
      return { seasonId: input.seasonId, version };
    });
  }

  async publish(
    context: AuthorizationContext,
    input: SeasonPublishInput,
  ): Promise<SeasonPublishResult> {
    return inTransaction(this.database, async (client) => {
      await authorizedHouse(client, context);
      const season = await authorizedSeason(client, context, input.seasonId);
      if (season.state === 'active') {
        return {
          seasonId: input.seasonId,
          houseId: context.houseId,
          state: 'active',
          publishedCharterVersion: parseInteger(
            season.published_charter_version,
            'published Charter version',
          ),
          activatedNow: false,
        };
      }
      if (season.state !== 'draft') {
        throw new DomainError('conflict', 'Only a draft Season can be published');
      }
      const active = await client.query(
        `select 1 from seasons
          where house_id = $1 and id <> $2 and state in ('active', 'closing')
          limit 1`,
        [context.houseId, input.seasonId],
      );
      if (active.rowCount !== 0) {
        throw new DomainError('conflict', 'House already has an active or closing Season');
      }
      const charter = await client.query<{ version: number }>(
        `select version
           from season_charters
          where season_id = $1
          order by version desc
          limit 1
          for update`,
        [input.seasonId],
      );
      if (charter.rows[0] === undefined) {
        throw new DomainError('validation_failed', 'A draft Charter is required to publish');
      }
      const version = parseInteger(charter.rows[0].version, 'Charter version');
      await client.query(
        `update season_charters
            set published_at = $3
          where season_id = $1 and version = $2`,
        [input.seasonId, version, input.publishedAt],
      );
      await client.query(
        `update seasons
            set title = $3, state = 'active', starts_at = $4, ends_at = $5,
                published_charter_version = $6, updated_at = $7
          where id = $1 and house_id = $2`,
        [
          input.seasonId,
          context.houseId,
          input.title,
          input.startsAt,
          input.endsAt,
          version,
          input.publishedAt,
        ],
      );
      return {
        seasonId: input.seasonId,
        houseId: context.houseId,
        state: 'active',
        publishedCharterVersion: version,
        activatedNow: true,
      };
    });
  }
}
