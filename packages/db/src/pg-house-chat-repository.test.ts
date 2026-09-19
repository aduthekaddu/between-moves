import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { NIGHT_CHAT_DELETED_TOPIC, NIGHT_CHAT_POSTED_TOPIC } from '@between-moves/domain';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgHouseChatRepository } from './pg-house-chat-repository';

const houseId = '01941f29-7c00-0000-0000-000000000201';
const nightId = '01941f29-7c00-0000-0000-000000000901';
const messageId = '01941f29-7c00-0000-0000-000000000801';
const eventId = '01941f29-7c00-0000-0000-000000000811';
const membershipId = '01941f29-7c00-0000-0000-000000000601';
const context = fakeAuthorizationContext({
  houseId,
  viewerId: '01941f29-7c00-0000-0000-000000000101',
});

interface ActorRow {
  readonly actor_membership_id: unknown;
  readonly actor_role: unknown;
  readonly display_name: unknown;
  readonly chat_sequence: unknown;
  readonly night_state: unknown;
}

interface MessageRow {
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

function actor(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    actor_membership_id: membershipId,
    actor_role: 'owner',
    display_name: 'Ada',
    chat_sequence: '1',
    night_state: 'live',
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    current_membership_id: membershipId,
    actor_role: 'owner',
    chat_sequence: '1',
    id: messageId,
    membership_id: membershipId,
    author_display_name: 'Ada',
    body: 'A quiet move.',
    sequence: '1',
    created_at: '2026-09-18T14:00:00.000Z',
    ...overrides,
  };
}

function database(
  options: {
    readonly actorRows?: readonly ActorRow[];
    readonly readRows?: readonly MessageRow[];
    readonly deletedRows?: readonly { readonly id: string }[];
  } = {},
) {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('for update of n')) {
      const rows = options.actorRows ?? [actor()];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('returning id')) {
      const rows = options.deletedRows ?? [{ id: messageId }];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 1 };
  });
  const poolQuery = vi.fn(async () => {
    const rows = options.readRows ?? [message()];
    return { rows, rowCount: rows.length };
  });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return {
    pool: { query: poolQuery, connect } as unknown as Pool,
    poolQuery,
    clientQuery,
    connect,
    release,
  };
}

describe('PostgreSQL House-chat repository mapping', () => {
  it('[BM-040] commits a durable message and enqueues the posted event atomically', async () => {
    const state = database();
    const postedAt = new Date('2026-09-18T14:01:00.000Z');

    await expect(
      new PgHouseChatRepository(state.pool).post(context, {
        id: messageId,
        eventId,
        nightId,
        body: '<b>Plain text</b>',
        postedAt,
      }),
    ).resolves.toEqual({
      id: messageId,
      membershipId,
      authorDisplayName: 'Ada',
      body: '<b>Plain text</b>',
      sequence: 2n,
      createdAt: postedAt,
    });

    expect(state.connect).toHaveBeenCalledOnce();
    expect(state.clientQuery).toHaveBeenCalledWith('commit');
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into outbox_events'),
      expect.arrayContaining([eventId, NIGHT_CHAT_POSTED_TOPIC, messageId, '1', houseId]),
    );
  });

  it('[BM-040] maps a recent snapshot, filters deleted left-join rows, and exposes moderation', async () => {
    const state = database({
      readRows: [
        message(),
        message({ id: null, body: null, membership_id: null, author_display_name: null }),
      ],
    });

    await expect(
      new PgHouseChatRepository(state.pool).readRecent(context, nightId),
    ).resolves.toEqual({
      houseId,
      nightId,
      chatSequence: 1n,
      currentMembershipId: membershipId,
      canModerate: true,
      messages: [
        {
          id: messageId,
          membershipId,
          authorDisplayName: 'Ada',
          body: 'A quiet move.',
          sequence: 1n,
          createdAt: new Date('2026-09-18T14:00:00.000Z'),
        },
      ],
    });
    expect(state.poolQuery).toHaveBeenCalledWith(expect.stringContaining('left join recent'), [
      houseId,
      nightId,
      context.viewerId,
      50,
    ]);
  });

  it('[BM-040] returns no snapshot when the Night is outside the House scope', async () => {
    await expect(
      new PgHouseChatRepository(database({ readRows: [] }).pool).readRecent(context, nightId),
    ).resolves.toBeNull();
  });

  it('[BM-040] commits a soft-delete and publishes its metadata-only event', async () => {
    const state = database();
    const deletedAt = new Date('2026-09-18T14:02:00.000Z');

    await expect(
      new PgHouseChatRepository(state.pool).softDelete(context, {
        eventId,
        nightId,
        messageId,
        deletedAt,
      }),
    ).resolves.toBeUndefined();

    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into outbox_events'),
      expect.arrayContaining([eventId, NIGHT_CHAT_DELETED_TOPIC, messageId, '2', houseId]),
    );
    expect(state.clientQuery).toHaveBeenCalledWith('commit');
    expect(state.release).toHaveBeenCalledOnce();
  });

  it('[BM-040] rolls back a post when the Night is unavailable', async () => {
    const state = database({ actorRows: [] });

    await expect(
      new PgHouseChatRepository(state.pool).post(context, {
        id: messageId,
        eventId,
        nightId,
        body: 'Unavailable',
        postedAt: new Date('2026-09-18T14:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(state.clientQuery).toHaveBeenCalledWith('rollback');
    expect(state.release).toHaveBeenCalledOnce();
  });

  it('[BM-040] rejects malformed durable chat rows', async () => {
    await expect(
      new PgHouseChatRepository(
        database({ readRows: [message({ current_membership_id: 42 })] }).pool,
      ).readRecent(context, nightId),
    ).rejects.toThrow('Invalid House chat membership');

    await expect(
      new PgHouseChatRepository(
        database({ readRows: [message({ sequence: '-1' })] }).pool,
      ).readRecent(context, nightId),
    ).rejects.toThrow('Invalid House chat sequence');

    await expect(
      new PgHouseChatRepository(
        database({ readRows: [message({ created_at: 'not-a-date' })] }).pool,
      ).readRecent(context, nightId),
    ).rejects.toThrow('Invalid House chat created timestamp');
  });

  it('[BM-040] rolls back when a message is already removed or the moderator is unavailable', async () => {
    const missingMessage = database({ deletedRows: [] });
    await expect(
      new PgHouseChatRepository(missingMessage.pool).softDelete(context, {
        eventId,
        nightId,
        messageId,
        deletedAt: new Date('2026-09-18T14:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(missingMessage.clientQuery).toHaveBeenCalledWith('rollback');

    const missingActor = database({ actorRows: [] });
    await expect(
      new PgHouseChatRepository(missingActor.pool).softDelete(context, {
        eventId,
        nightId,
        messageId,
        deletedAt: new Date('2026-09-18T14:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(missingActor.clientQuery).toHaveBeenCalledWith('rollback');
  });
});
