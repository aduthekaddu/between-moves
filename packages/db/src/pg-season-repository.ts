import {
  DomainError,
  materializeNightSchedule,
  type AuthorizationContext,
  type CharterDraftInput,
  type CharterDraftResult,
  type ClosedSeasonReadRepository,
  type ClosedSeasonView,
  type SeasonCloseResult,
  type SeasonClosingInput,
  type SeasonClosingRepository,
  type SeasonClosingResult,
  type SeasonDraftInput,
  type SeasonDraftResult,
  type SeasonFinalizeInput,
  type SeasonPublishInput,
  type SeasonPublishResult,
  type SeasonReadRepository,
  type SeasonRepository,
  type NightRecurrence,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  closingDate,
  readFinalStandings,
  readLatestClosedSeason,
  snapshotAndEnqueueClosing,
} from './pg-season-closing';
import { parseHouseSeasonRow, type HouseSeasonRow } from './season-row-parser';

interface SeasonRow extends QueryResultRow {
  readonly state: unknown;
  readonly published_charter_version: unknown;
  readonly closed_at: unknown;
  readonly actor_membership_id: unknown;
}

interface ExistingDraftRow extends QueryResultRow {
  readonly id: unknown;
  readonly draft_idempotency_payload_digest: unknown;
}

interface PublishCharterRow extends QueryResultRow {
  readonly version: unknown;
  readonly night_recurrence: unknown;
  readonly time_zone: unknown;
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Season ${field}`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Season ${field}`);
  return value;
}

function parseNightRecurrence(value: unknown): NightRecurrence {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Night recurrence');
  const recurrence = value as Record<string, unknown>;
  if (
    !Number.isInteger(recurrence.weekday) ||
    typeof recurrence.localTime !== 'string' ||
    recurrence.count !== 4
  ) {
    throw new Error('Invalid Night recurrence');
  }
  return {
    weekday: recurrence.weekday as number,
    localTime: recurrence.localTime,
    count: 4,
  };
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
    `select s.state, s.published_charter_version, s.closed_at,
            m.id::text as actor_membership_id
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
export class PgSeasonRepository
  implements
    SeasonRepository,
    SeasonReadRepository,
    SeasonClosingRepository,
    ClosedSeasonReadRepository
{
  constructor(private readonly database: Pool) {}

  readLatestClosed(context: AuthorizationContext): Promise<ClosedSeasonView | null> {
    return readLatestClosedSeason(this.database, context);
  }

  /** [BM-047] Enter `closing` with a standings snapshot; replays report the current state. */
  async beginClosing(
    context: AuthorizationContext,
    input: SeasonClosingInput,
  ): Promise<SeasonClosingResult> {
    return inTransaction(this.database, async (client) => {
      await authorizedHouse(client, context);
      const season = await authorizedSeason(client, context, input.seasonId);
      const actorMembershipId = parseString(season.actor_membership_id, 'actor membership id');
      const replay = { seasonId: input.seasonId, houseId: context.houseId, actorMembershipId };
      if (season.state === 'closing' || season.state === 'closed') {
        return {
          ...replay,
          state: season.state,
          standings: await readFinalStandings(client, context.houseId, input.seasonId),
          closingNow: false,
        };
      }
      if (season.state !== 'active') {
        throw new DomainError('conflict', 'Only an active Season can be closed');
      }
      return {
        ...replay,
        state: 'closing',
        standings: await snapshotAndEnqueueClosing(client, context, input, actorMembershipId),
        closingNow: true,
      };
    });
  }

  /** [BM-047] Finalize a closing Season; a closed Season replays its original close time. */
  async finalize(
    context: AuthorizationContext,
    input: SeasonFinalizeInput,
  ): Promise<SeasonCloseResult> {
    return inTransaction(this.database, async (client) => {
      await authorizedHouse(client, context);
      const season = await authorizedSeason(client, context, input.seasonId);
      const result = {
        seasonId: input.seasonId,
        houseId: context.houseId,
        state: 'closed' as const,
        actorMembershipId: parseString(season.actor_membership_id, 'actor membership id'),
        standings: await readFinalStandings(client, context.houseId, input.seasonId),
      };
      if (season.state === 'closed') {
        return {
          ...result,
          closedAt: closingDate(season.closed_at, 'closed time'),
          closedNow: false,
        };
      }
      if (season.state !== 'closing') {
        throw new DomainError('conflict', 'Only a closing Season can be finalized');
      }
      await client.query(
        `update seasons
            set state = 'closed', closed_at = $3, updated_at = $3
          where id = $1 and house_id = $2 and state = 'closing'`,
        [input.seasonId, context.houseId, input.closedAt],
      );
      return { ...result, closedAt: input.closedAt, closedNow: true };
    });
  }

  async readCurrent(context: AuthorizationContext) {
    const result = await this.database.query<HouseSeasonRow & QueryResultRow>(
      `select s.id, s.title, s.state, s.starts_at, s.ends_at,
              c.version as charter_version,
              c.correspondence_pace_hours,
              c.night_recurrence,
              c.points_recipe
         from seasons s
         join houses h on h.id = s.house_id and h.status = 'active'
         join memberships m
           on m.house_id = s.house_id
          and m.user_id = $2
          and m.status = 'active'
         left join lateral (
           select version, correspondence_pace_hours, night_recurrence, points_recipe
             from season_charters
            where season_id = s.id
            order by case when version = s.published_charter_version then 0 else 1 end,
                     version desc
            limit 1
         ) c on true
        where s.house_id = $1 and s.state in ('active', 'closing', 'draft')
        order by case s.state when 'active' then 0 when 'closing' then 1 else 2 end,
                 s.created_at desc
        limit 1`,
      [context.houseId, context.viewerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseHouseSeasonRow(row);
  }

  async draft(context: AuthorizationContext, input: SeasonDraftInput): Promise<SeasonDraftResult> {
    return inTransaction(this.database, async (client) => {
      await authorizedHouse(client, context);
      if (input.idempotencyKey !== null) {
        const existing = await client.query<ExistingDraftRow>(
          `select id::text, draft_idempotency_payload_digest
             from seasons
            where house_id = $1
              and draft_idempotency_digest = encode(digest($2, 'sha256'), 'hex')
            limit 1`,
          [context.houseId, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (row !== undefined) {
          const payloadDigest = parseString(
            row.draft_idempotency_payload_digest,
            'draft idempotency payload digest',
          );
          const expectedPayload = await client.query<{ digest: string }>(
            `select encode(digest($1, 'sha256'), 'hex') as digest`,
            [input.title],
          );
          if (expectedPayload.rows[0]?.digest !== payloadDigest) {
            throw new DomainError(
              'idempotency_conflict',
              'Idempotency key was reused for another Season draft',
            );
          }
          return {
            seasonId: parseString(row.id, 'id'),
            houseId: context.houseId,
            state: 'draft',
            createdNow: false,
          };
        }
      }
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
          (id, house_id, title, draft_idempotency_digest, draft_idempotency_payload_digest,
           state, created_at, updated_at)
         values ($1, $2, $3,
                 case when $5::text is null then null else encode(digest($5, 'sha256'), 'hex') end,
                 case when $5::text is null then null else encode(digest($3, 'sha256'), 'hex') end,
                 'draft', $4, $4)`,
        [input.seasonId, context.houseId, input.title, input.createdAt, input.idempotencyKey],
      );
      return {
        seasonId: input.seasonId,
        houseId: context.houseId,
        state: 'draft',
        createdNow: true,
      };
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
          actorMembershipId: parseString(season.actor_membership_id, 'actor membership id'),
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
      const charter = await client.query<PublishCharterRow>(
        `select c.version, c.night_recurrence, h.time_zone
           from season_charters c
           join seasons s on s.id = c.season_id
           join houses h on h.id = s.house_id
          where c.season_id = $1 and s.house_id = $2
          order by c.version desc
          limit 1
          for update of c`,
        [input.seasonId, context.houseId],
      );
      const charterRow = charter.rows[0];
      if (charterRow === undefined) {
        throw new DomainError('validation_failed', 'A draft Charter is required to publish');
      }
      const version = parseInteger(charterRow.version, 'Charter version');
      const schedule = materializeNightSchedule({
        ids: input.nightIds,
        seasonStartsAt: input.startsAt,
        seasonEndsAt: input.endsAt,
        recurrence: parseNightRecurrence(charterRow.night_recurrence),
        timeZone: parseString(charterRow.time_zone, 'House time zone'),
      });
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
      for (const night of schedule) {
        await client.query(
          `insert into house_nights
            (id, house_id, season_id, scheduled_start, scheduled_end, state,
             created_at, updated_at)
           values ($1, $2, $3, $4, $5, 'scheduled', $6, $6)`,
          [
            night.nightId,
            context.houseId,
            input.seasonId,
            night.scheduledStart,
            night.scheduledEnd,
            input.publishedAt,
          ],
        );
      }
      return {
        seasonId: input.seasonId,
        houseId: context.houseId,
        state: 'active',
        publishedCharterVersion: version,
        activatedNow: true,
        actorMembershipId: parseString(season.actor_membership_id, 'actor membership id'),
      };
    });
  }
}
