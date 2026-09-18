import {
  DomainError,
  HOUSE_CHAT_RECENT_LIMIT,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  type AuthorizationContext,
  type DeleteHouseChatInput,
  type HouseChatMessage,
  type HouseChatRepository,
  type HouseChatSnapshot,
  type PostHouseChatInput,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

interface ActorNightRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly actor_role: unknown;
  readonly display_name: unknown;
  readonly chat_sequence: unknown;
  readonly night_state: unknown;
}

interface MessageRow extends QueryResultRow {
  readonly current_membership_id?: unknown;
  readonly actor_role?: unknown;
  readonly chat_sequence?: unknown;
  readonly id: unknown;
  readonly membership_id: unknown;
  readonly author_display_name: unknown;
  readonly body: unknown;
  readonly sequence: unknown;
  readonly created_at: unknown;
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

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid House chat ${field}`);
  return value;
}

function parseDate(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid House chat ${label}`);
  return parsed;
}

function parseSequence(value: unknown, field: string): bigint {
  const parsed = typeof value === 'bigint' ? value : BigInt(String(value));
  if (parsed < 0n) throw new Error(`Invalid House chat ${field}`);
  return parsed;
}

function parseMessage(row: MessageRow): HouseChatMessage {
  return {
    id: text(row.id, 'id'),
    membershipId: text(row.membership_id, 'membership'),
    authorDisplayName: text(row.author_display_name, 'author'),
    body: text(row.body, 'body'),
    sequence: parseSequence(row.sequence, 'sequence'),
    createdAt: parseDate(row.created_at, 'created timestamp'),
  };
}

async function lockLiveNight(
  client: PoolClient,
  context: AuthorizationContext,
  nightId: string,
): Promise<ActorNightRow> {
  const result = await client.query<ActorNightRow>(
    `select actor.id::text as actor_membership_id,
            actor.role as actor_role,
            person.display_name,
            n.chat_sequence::text,
            n.state as night_state
       from house_nights n
       join houses h on h.id = n.house_id and h.status = 'active'
       join memberships actor
         on actor.house_id = n.house_id
        and actor.user_id = $3
        and actor.status = 'active'
       join users person on person.id = actor.user_id
      where n.id = $1 and n.house_id = $2 and n.state = 'live'
      for update of n`,
    [nightId, context.houseId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'House chat is unavailable');
  return row;
}

/** [BM-040] PostgreSQL House chat with durable write then outbox publish. */
export class PgHouseChatRepository implements HouseChatRepository {
  constructor(private readonly database: Pool) {}

  async post(context: AuthorizationContext, input: PostHouseChatInput): Promise<HouseChatMessage> {
    return transaction(this.database, async (client) => {
      const night = await lockLiveNight(client, context, input.nightId);
      const membershipId = text(night.actor_membership_id, 'actor membership');
      const authorDisplayName = text(night.display_name, 'author');
      const nextSequence = parseSequence(night.chat_sequence, 'chat sequence') + 1n;
      await client.query(
        `update house_nights
            set chat_sequence = $3, updated_at = $4
          where id = $1 and house_id = $2`,
        [input.nightId, context.houseId, nextSequence.toString(), input.postedAt],
      );
      await client.query(
        `insert into house_messages
           (id, house_id, night_id, membership_id, body, sequence, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          context.houseId,
          input.nightId,
          membershipId,
          input.body,
          nextSequence.toString(),
          input.postedAt,
        ],
      );
      await enqueueOutboxEvent(
        {
          id: input.eventId,
          topic: NIGHT_CHAT_POSTED_TOPIC,
          aggregateId: input.id,
          sequence: 1n,
          houseId: context.houseId,
          payload: {
            nightId: input.nightId,
            messageId: input.id,
            membershipId,
            authorDisplayName,
            body: input.body,
            createdAt: input.postedAt.toISOString(),
            chatSequence: nextSequence.toString(),
          },
          availableAt: input.postedAt,
          occurredAt: input.postedAt,
        },
        client,
      );
      return {
        id: input.id,
        membershipId,
        authorDisplayName,
        body: input.body,
        sequence: nextSequence,
        createdAt: input.postedAt,
      };
    });
  }

  async readRecent(
    context: AuthorizationContext,
    nightId: string,
  ): Promise<HouseChatSnapshot | null> {
    const result = await this.database.query<MessageRow>(
      `with scope as (
         select actor.id as current_membership_id,
                actor.role as actor_role,
                n.chat_sequence
           from house_nights n
           join houses h on h.id = n.house_id and h.status = 'active'
           join memberships actor
             on actor.house_id = n.house_id
            and actor.user_id = $3
            and actor.status = 'active'
          where n.id = $2 and n.house_id = $1
       ), recent as (
         select msg.id, msg.membership_id, msg.body, msg.sequence, msg.created_at
           from house_messages msg
           join scope on true
          where msg.house_id = $1 and msg.night_id = $2 and msg.deleted_at is null
          order by msg.sequence desc
          limit $4
       )
       select scope.current_membership_id::text,
              scope.actor_role,
              scope.chat_sequence::text,
              recent.id::text,
              recent.membership_id::text,
              case when author.status = 'active' then person.display_name else 'Former member' end
                as author_display_name,
              recent.body,
              recent.sequence::text,
              recent.created_at
         from scope
         left join recent on true
         left join memberships author on author.id = recent.membership_id
         left join users person on person.id = author.user_id
        order by recent.sequence`,
      [context.houseId, nightId, context.viewerId, HOUSE_CHAT_RECENT_LIMIT],
    );
    const first = result.rows[0];
    if (first === undefined) return null;
    if (typeof first.current_membership_id !== 'string' || typeof first.actor_role !== 'string') {
      throw new Error('Invalid House chat membership');
    }
    return {
      houseId: context.houseId,
      nightId,
      chatSequence: parseSequence(first.chat_sequence, 'chat sequence'),
      currentMembershipId: first.current_membership_id,
      canModerate: first.actor_role === 'owner' || first.actor_role === 'steward',
      messages: result.rows.filter((row) => row.id !== null).map(parseMessage),
    };
  }

  async softDelete(context: AuthorizationContext, input: DeleteHouseChatInput): Promise<void> {
    await transaction(this.database, async (client) => {
      const night = await client.query<ActorNightRow>(
        `select actor.id::text as actor_membership_id,
                actor.role as actor_role,
                person.display_name,
                n.chat_sequence::text,
                n.state as night_state
           from house_nights n
           join houses h on h.id = n.house_id and h.status = 'active'
           join memberships actor
             on actor.house_id = n.house_id
            and actor.user_id = $3
            and actor.status = 'active'
            and actor.role in ('owner', 'steward')
           join users person on person.id = actor.user_id
          where n.id = $1 and n.house_id = $2 and n.state in ('live', 'ended')
          for update of n`,
        [input.nightId, context.houseId, context.viewerId],
      );
      const actor = night.rows[0];
      if (actor === undefined) throw new DomainError('not_found', 'House chat is unavailable');
      const updated = await client.query<{ id: string }>(
        `update house_messages
            set deleted_at = $4, deleted_by_membership_id = $5
          where id = $1 and house_id = $2 and night_id = $3 and deleted_at is null
        returning id`,
        [
          input.messageId,
          context.houseId,
          input.nightId,
          input.deletedAt,
          text(actor.actor_membership_id, 'actor membership'),
        ],
      );
      if (updated.rowCount !== 1) {
        throw new DomainError('not_found', 'House chat message is unavailable');
      }
      const nextSequence = parseSequence(actor.chat_sequence, 'chat sequence') + 1n;
      await client.query(
        `update house_nights
            set chat_sequence = $3, updated_at = $4
          where id = $1 and house_id = $2`,
        [input.nightId, context.houseId, nextSequence.toString(), input.deletedAt],
      );
      await enqueueOutboxEvent(
        {
          id: input.eventId,
          topic: NIGHT_CHAT_DELETED_TOPIC,
          aggregateId: input.messageId,
          sequence: 2n,
          houseId: context.houseId,
          payload: {
            nightId: input.nightId,
            messageId: input.messageId,
            chatSequence: nextSequence.toString(),
          },
          availableAt: input.deletedAt,
          occurredAt: input.deletedAt,
        },
        client,
      );
    });
  }
}
