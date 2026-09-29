import {
  DomainError,
  NIGHT_ENDED_TOPIC,
  NIGHT_STARTED_TOPIC,
  transitionNightLifecycle,
  type AssignNightHostInput,
  type AuthorizationContext,
  type HouseNightHostAssignmentRepository,
  type NightHostCandidate,
  type NightEndInput,
  type NightLifecycleEvent,
  type NightLifecycleInput,
  type NightLifecycleRepository,
  type NightLifecycleResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';
import { settleNightAttendance } from './pg-night-attendance-repository';
import {
  nightRsvpJoin,
  nightString,
  nightViewColumns,
  parseNight,
  type NightRow,
} from './night-row';

interface HostCandidateRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly display_name: unknown;
}

async function transaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query('begin');
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

async function lockAuthorizedNight(
  client: PoolClient,
  context: AuthorizationContext,
  nightId: string,
  privileged: boolean,
): Promise<NightRow> {
  const rolePredicate = privileged
    ? `m.role in ('owner', 'steward')`
    : `(m.role in ('owner', 'steward') or n.host_membership_id = m.id)`;
  const result = await client.query<NightRow>(
    `select ${nightViewColumns}, m.id::text as actor_membership_id
       from house_nights n
       join houses h on h.id = n.house_id and h.status = 'active'
       join seasons s
         on s.id = n.season_id and s.house_id = n.house_id
        and s.state in ('active', 'closing')
       join memberships m
         on m.house_id = n.house_id
        and m.user_id = $3
        and m.status = 'active'
        and ${rolePredicate}
       ${nightRsvpJoin}
      where n.id = $1 and n.house_id = $2
      for update of n`,
    [nightId, context.houseId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Night is unavailable');
  return row;
}

async function applyLifecycle(
  client: PoolClient,
  context: AuthorizationContext,
  input: NightLifecycleInput | NightEndInput,
  event: NightLifecycleEvent,
): Promise<NightLifecycleResult> {
  const previous = parseNight(await lockAuthorizedNight(client, context, input.nightId, false));
  const transition = transitionNightLifecycle(previous.state, event);
  if (!transition.changedNow) return { night: previous, changedNow: false };
  const startedAt = event === 'start' ? input.at : previous.startedAt;
  const endedAt = event === 'end' ? input.at : previous.endedAt;
  const updated = await client.query<NightRow>(
    `update house_nights
        set state = $3, started_at = $4, ended_at = $5, updated_at = $6
      where id = $1 and house_id = $2
    returning id::text, house_id::text, season_id::text, scheduled_start, scheduled_end,
              state, host_membership_id::text, started_at, ended_at`,
    [input.nightId, context.houseId, transition.state, startedAt, endedAt, input.at],
  );
  const night = parseNight({
    ...(updated.rows[0] as NightRow),
    viewer_is_host: previous.viewerIsHost,
    viewer_rsvp: previous.viewerRsvp,
  });
  if (event === 'end' && 'settlementIds' in input) {
    // [BM-036] nobody stays at the table after the Night: close every open interval now
    await settleNightAttendance(client, {
      houseId: context.houseId,
      nightId: input.nightId,
      endedAt: input.at,
      ids: input.settlementIds,
    });
  }
  await enqueueOutboxEvent(
    {
      id: input.eventId,
      topic: event === 'start' ? NIGHT_STARTED_TOPIC : NIGHT_ENDED_TOPIC,
      aggregateId: input.nightId,
      sequence: event === 'start' ? 1n : 2n,
      houseId: context.houseId,
      payload: { nightId: input.nightId, at: input.at.toISOString() },
      availableAt: input.at,
      occurredAt: input.at,
    },
    client,
  );
  return { night, changedNow: true };
}

/** [BM-035] [DR-NIGHT-01/03] [DR-PERM-02] Start, end, and temporary Night host assignment. */
export class PgNightLifecycleRepository
  implements NightLifecycleRepository, HouseNightHostAssignmentRepository
{
  constructor(private readonly database: Pool) {}

  async start(
    context: AuthorizationContext,
    input: NightLifecycleInput,
  ): Promise<NightLifecycleResult> {
    return transaction(this.database, (client) => applyLifecycle(client, context, input, 'start'));
  }

  async end(context: AuthorizationContext, input: NightEndInput): Promise<NightLifecycleResult> {
    return transaction(this.database, (client) => applyLifecycle(client, context, input, 'end'));
  }

  async assignHost(
    context: AuthorizationContext,
    input: AssignNightHostInput,
  ): Promise<NightLifecycleResult> {
    return transaction(this.database, async (client) => {
      const row = await lockAuthorizedNight(client, context, input.nightId, true);
      const previous = parseNight(row);
      if (previous.state === 'cancelled' || previous.state === 'ended') {
        throw new DomainError('conflict', 'Only a scheduled or live Night can receive a host');
      }
      const host = await client.query<{ id: unknown }>(
        `select id::text
           from memberships
          where id = $1 and house_id = $2 and status = 'active'`,
        [input.hostMembershipId, context.houseId],
      );
      if (host.rows[0] === undefined) {
        throw new DomainError('validation_failed', 'Night host must be an active House Member');
      }
      const viewerIsHost =
        input.hostMembershipId === nightString(row.actor_membership_id, 'actor membership id');
      if (previous.hostMembershipId === input.hostMembershipId) {
        return {
          night: { ...previous, viewerIsHost },
          changedNow: false,
        };
      }
      const updated = await client.query<NightRow>(
        `update house_nights
            set host_membership_id = $3, updated_at = $4
          where id = $1 and house_id = $2
        returning id::text, house_id::text, season_id::text, scheduled_start, scheduled_end,
                  state, host_membership_id::text, started_at, ended_at`,
        [input.nightId, context.houseId, input.hostMembershipId, input.assignedAt],
      );
      return {
        night: parseNight({
          ...(updated.rows[0] as NightRow),
          viewer_is_host: viewerIsHost,
          viewer_rsvp: previous.viewerRsvp,
        }),
        changedNow: true,
      };
    });
  }

  async listHostCandidates(context: AuthorizationContext): Promise<readonly NightHostCandidate[]> {
    const result = await this.database.query<HostCandidateRow>(
      `select m.id::text as membership_id, u.display_name
         from memberships m
         join users u on u.id = m.user_id
         join houses h on h.id = m.house_id and h.status = 'active'
         join memberships viewer
           on viewer.house_id = m.house_id
          and viewer.user_id = $2
          and viewer.status = 'active'
        where m.house_id = $1 and m.status = 'active'
        order by u.display_name, m.id`,
      [context.houseId, context.viewerId],
    );
    return result.rows.map((row) => ({
      membershipId: nightString(row.membership_id, 'membership id'),
      displayName: nightString(row.display_name, 'display name'),
    }));
  }

  async isAssignedNightHost(input: {
    readonly houseId: string;
    readonly nightId: string;
    readonly membershipId: string;
    readonly operation?: 'start' | 'end';
  }): Promise<boolean> {
    const result = await this.database.query(
      `select 1
         from house_nights n
         join houses h on h.id = n.house_id and h.status = 'active'
        where n.id = $1
          and n.house_id = $2
          and n.host_membership_id = $3
          and (
            ($4::text is null and n.state <> 'cancelled')
            or ($4 = 'start' and n.state in ('scheduled', 'live'))
            or ($4 = 'end' and n.state in ('live', 'ended'))
          )`,
      [input.nightId, input.houseId, input.membershipId, input.operation ?? null],
    );
    return result.rows[0] !== undefined;
  }
}
