import {
  DomainError,
  type AuthorizationContext,
  type NightRsvp,
  type NightRsvpInput,
  type NightRsvpRepository,
  type NightRsvpStatus,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { nightDate, nightString } from './night-row';

interface RsvpRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly night_id: unknown;
  readonly membership_id: unknown;
  readonly status: unknown;
  readonly responded_at: unknown;
}

function statusValue(value: unknown): NightRsvpStatus {
  if (value === 'going' || value === 'not_going') return value;
  throw new Error('Invalid Night RSVP');
}

function parseRsvp(row: RsvpRow): NightRsvp {
  return {
    rsvpId: nightString(row.id, 'id'),
    houseId: nightString(row.house_id, 'House id'),
    nightId: nightString(row.night_id, 'Night id'),
    membershipId: nightString(row.membership_id, 'membership id'),
    status: statusValue(row.status),
    respondedAt: nightDate(row.responded_at, 'responded at'),
  };
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

/** [BM-035] House-scoped RSVP upsert for one Night and Member. */
export class PgNightRsvpRepository implements NightRsvpRepository {
  constructor(private readonly database: Pool) {}

  async rsvp(context: AuthorizationContext, input: NightRsvpInput): Promise<NightRsvp> {
    if (input.status !== 'going' && input.status !== 'not_going') {
      throw new DomainError('validation_failed', 'Night RSVP is invalid');
    }
    return transaction(this.database, async (client) => {
      const authorized = await client.query<{ membership_id: unknown }>(
        `select m.id::text as membership_id
           from house_nights n
           join houses h on h.id = n.house_id and h.status = 'active'
           join seasons s
             on s.id = n.season_id and s.house_id = n.house_id
            and s.state in ('active', 'closing')
           join memberships m
             on m.house_id = n.house_id
            and m.user_id = $3
            and m.status = 'active'
          where n.id = $1 and n.house_id = $2 and n.state in ('scheduled', 'live')
          for share of n, m`,
        [input.nightId, context.houseId, context.viewerId],
      );
      const membershipId = authorized.rows[0]?.membership_id;
      if (typeof membershipId !== 'string') {
        throw new DomainError('not_found', 'Night is unavailable');
      }
      const result = await client.query<RsvpRow>(
        `insert into night_rsvps
          (id, house_id, night_id, membership_id, status, responded_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $6, $6)
         on conflict (night_id, membership_id) do update
           set status = excluded.status,
               responded_at = excluded.responded_at,
               updated_at = excluded.updated_at
        returning id::text, house_id::text, night_id::text, membership_id::text,
                  status, responded_at`,
        [
          input.rsvpId,
          context.houseId,
          input.nightId,
          membershipId,
          input.status,
          input.respondedAt,
        ],
      );
      return parseRsvp(result.rows[0] as RsvpRow);
    });
  }
}
