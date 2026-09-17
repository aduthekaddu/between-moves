import {
  DomainError,
  type AuthorizationContext,
  type HouseNightView,
  type NightChangeInput,
  type NightChangeResult,
  type NightRepository,
} from '@between-moves/domain';
import type { Pool, PoolClient } from 'pg';
import {
  nightRsvpJoin,
  nightString,
  nightViewColumns,
  parseNight,
  type NightRow,
} from './night-row';

async function transaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new DomainError('conflict', 'Another Night already uses that scheduled start', {
        cause: error,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** [BM-020] [DR-NIGHT-01/03] House-scoped Night reads, edits, and transactional audit. */
export class PgNightRepository implements NightRepository {
  constructor(private readonly database: Pool) {}

  async list(context: AuthorizationContext): Promise<readonly HouseNightView[]> {
    const result = await this.database.query<NightRow>(
      `select ${nightViewColumns}
         from house_nights n
         join seasons s on s.id = n.season_id and s.house_id = n.house_id
         join houses h on h.id = n.house_id and h.status = 'active'
         join memberships m
           on m.house_id = n.house_id
          and m.user_id = $2
          and m.status = 'active'
         ${nightRsvpJoin}
        where n.house_id = $1
          and s.state in ('active', 'closing')
        order by n.scheduled_start, n.id`,
      [context.houseId, context.viewerId],
    );
    return result.rows.map(parseNight);
  }

  async change(context: AuthorizationContext, input: NightChangeInput): Promise<NightChangeResult> {
    return transaction(this.database, async (client) => {
      const result = await client.query<NightRow>(
        `select ${nightViewColumns}, m.id::text as actor_membership_id
           from house_nights n
           join houses h on h.id = n.house_id and h.status = 'active'
           join memberships m
             on m.house_id = n.house_id
            and m.user_id = $3
            and m.status = 'active'
            and m.role in ('owner', 'steward')
           ${nightRsvpJoin}
          where n.id = $1 and n.house_id = $2
          for update of n`,
        [input.nightId, context.houseId, context.viewerId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new DomainError('not_found', 'Night is unavailable');
      const previous = parseNight(row);
      if (input.command.kind === 'cancel' && previous.state === 'cancelled') {
        return { night: previous, changedNow: false };
      }
      if (previous.state !== 'scheduled') {
        throw new DomainError('conflict', 'Only a scheduled Night can be changed');
      }
      const scheduledStart =
        input.command.kind === 'reschedule'
          ? input.command.scheduledStart
          : previous.scheduledStart;
      const scheduledEnd =
        input.command.kind === 'reschedule' ? input.command.scheduledEnd : previous.scheduledEnd;
      const state = input.command.kind === 'cancel' ? 'cancelled' : 'scheduled';
      if (
        state === previous.state &&
        scheduledStart.getTime() === previous.scheduledStart.getTime() &&
        scheduledEnd.getTime() === previous.scheduledEnd.getTime()
      ) {
        return { night: previous, changedNow: false };
      }
      const updated = await client.query<NightRow>(
        `update house_nights
            set scheduled_start = $3, scheduled_end = $4, state = $5, updated_at = $6
          where id = $1 and house_id = $2
        returning id::text, house_id::text, season_id::text,
                  scheduled_start, scheduled_end, state, host_membership_id::text,
                  started_at, ended_at`,
        [input.nightId, context.houseId, scheduledStart, scheduledEnd, state, input.changedAt],
      );
      const night = parseNight({
        ...(updated.rows[0] as NightRow),
        viewer_is_host: previous.viewerIsHost,
        viewer_rsvp: previous.viewerRsvp,
      });
      await client.query(
        `insert into night_audit
          (id, house_id, night_id, actor_membership_id, action,
           previous_scheduled_start, previous_scheduled_end,
           scheduled_start, scheduled_end, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.auditId,
          context.houseId,
          input.nightId,
          nightString(row.actor_membership_id, 'actor membership id'),
          input.command.kind === 'cancel' ? 'cancelled' : 'rescheduled',
          previous.scheduledStart,
          previous.scheduledEnd,
          night.scheduledStart,
          night.scheduledEnd,
          input.changedAt,
        ],
      );
      return { night, changedNow: true };
    });
  }
}
