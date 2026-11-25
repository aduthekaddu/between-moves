import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import {
  HOUSE_CHAT_RECENT_LIMIT,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
} from '@between-moves/domain';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgHouseChatRepository } from './pg-house-chat-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

describe('PostgreSQL House chat repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgHouseChatRepository(database);
  const seasonId = id(971);
  const nightId = id(972);
  const otherNightId = id(973);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const startedAt = new Date('2026-09-18T14:00:00.000Z');
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Chat season', 'draft', $3, $3)`,
      [seasonId, world.first.houseId, startedAt],
    );
    await database.query(
      `insert into house_nights
        (id, house_id, season_id, scheduled_start, scheduled_end, state, started_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'live', $6, $6, $6),
              ($7, $2, $3, $8, $9, 'scheduled', null, $6, $6)`,
      [
        nightId,
        world.first.houseId,
        seasonId,
        new Date('2026-09-18T14:00:00.000Z'),
        new Date('2026-09-18T16:00:00.000Z'),
        startedAt,
        otherNightId,
        new Date('2026-09-25T14:00:00.000Z'),
        new Date('2026-09-25T16:00:00.000Z'),
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-040] writes the message before the outbox event and keeps it after unpublished dispatch', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    const postedAt = new Date('2026-09-18T14:05:00.000Z');

    const message = await repository.post(context, {
      id: id(981),
      eventId: id(982),
      nightId,
      body: '<script>alert(1)</script>',
      postedAt,
    });
    expect(message).toMatchObject({
      id: id(981),
      membershipId: world.first.nonOwner.membershipId,
      authorDisplayName: world.first.nonOwner.displayName,
      body: '<script>alert(1)</script>',
      sequence: 1n,
      createdAt: postedAt,
    });

    const stored = await database.query<{ body: string; sent_at: Date | null; topic: string }>(
      `select m.body, o.sent_at, o.topic
         from house_messages m
         join outbox_events o on o.aggregate_id = m.id
        where m.id = $1`,
      [id(981)],
    );
    expect(stored.rows).toEqual([
      { body: '<script>alert(1)</script>', sent_at: null, topic: NIGHT_CHAT_POSTED_TOPIC },
    ]);

    const snapshot = await repository.readRecent(context, nightId);
    expect(snapshot).toMatchObject({
      houseId: world.first.houseId,
      nightId,
      chatSequence: 1n,
      canModerate: false,
      messages: [expect.objectContaining({ id: id(981), body: '<script>alert(1)</script>' })],
    });
  });

  it('[BM-040] soft-deletes a message so reconnect no longer renders it', async () => {
    const member = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    const owner = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    await repository.post(member, {
      id: id(983),
      eventId: id(984),
      nightId,
      body: 'Please remove this',
      postedAt: new Date('2026-09-18T14:06:00.000Z'),
    });

    await repository.softDelete(owner, {
      eventId: id(985),
      nightId,
      messageId: id(983),
      deletedAt: new Date('2026-09-18T14:07:00.000Z'),
    });

    const snapshot = await repository.readRecent(member, nightId);
    expect(snapshot).toMatchObject({
      chatSequence: 2n,
      messages: [],
    });
    const row = await database.query<{ deleted_at: Date | null; body: string; topic: string }>(
      `select m.deleted_at, m.body, o.topic
         from house_messages m
         join outbox_events o on o.id = $2
        where m.id = $1`,
      [id(983), id(985)],
    );
    expect(row.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(row.rows[0]?.body).toBe('Please remove this');
    expect(row.rows[0]?.topic).toBe(NIGHT_CHAT_DELETED_TOPIC);
  });

  it('[BM-040] [DR-SEC-01] never writes chat into another House', async () => {
    const crossed = fakeAuthorizationContext({
      houseId: world.second.houseId,
      viewerId: world.second.member.userId,
    });
    await expect(
      repository.post(crossed, {
        id: id(986),
        eventId: id(987),
        nightId,
        body: 'Crossed House chat',
        postedAt: new Date('2026-09-18T14:08:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      database.query('select count(*)::int as count from house_messages'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('[BM-040] rejects chat on a Night that is not live', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    await expect(
      repository.post(context, {
        id: id(988),
        eventId: id(989),
        nightId: otherNightId,
        body: 'Too early',
        postedAt: new Date('2026-09-18T14:09:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('[BM-040] refuses chat on an ended Night and refuses to delete a message twice', async () => {
    const owner = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    const postedAt = new Date('2026-09-18T14:12:00.000Z');
    await repository.post(owner, {
      id: id(994),
      eventId: id(995),
      nightId,
      body: 'Last word',
      postedAt,
    });
    await database.query(`update house_nights set state = 'ended', ended_at = $2 where id = $1`, [
      nightId,
      new Date('2026-09-18T16:00:00.000Z'),
    ]);
    await expect(
      repository.post(owner, {
        id: id(996),
        eventId: id(997),
        nightId,
        body: 'After the Night',
        postedAt: new Date('2026-09-18T16:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const remove = (eventId: string) =>
      repository.softDelete(owner, {
        eventId,
        nightId,
        messageId: id(994),
        deletedAt: new Date('2026-09-18T16:02:00.000Z'),
      });
    await remove(id(998));
    await expect(remove(id(999))).rejects.toMatchObject({ code: 'not_found' });
    // the refused second delete left no event and did not move the chat sequence
    await expect(
      database.query(`select count(*)::int as count from outbox_events where topic = $1`, [
        NIGHT_CHAT_DELETED_TOPIC,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      database.query('select chat_sequence::int as sequence from house_nights where id = $1', [
        nightId,
      ]),
    ).resolves.toMatchObject({ rows: [{ sequence: 2 }] });
  });

  it('[BM-040] reads the latest messages in order when a Night has more than the recent limit', async () => {
    const owner = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    const total = HOUSE_CHAT_RECENT_LIMIT + 2;
    await database.query(
      `insert into house_messages
         (id, house_id, night_id, membership_id, body, sequence, created_at)
       select ('01941f29-7c00-7000-8000-' || lpad((5000 + n)::text, 12, '0'))::uuid,
              $1, $2, $3, 'message ' || n, n, now()
         from generate_series(1, $4::int) as n`,
      [world.first.houseId, nightId, world.first.member.membershipId, total],
    );
    await database.query('update house_nights set chat_sequence = $2 where id = $1', [
      nightId,
      total,
    ]);

    const snapshot = await repository.readRecent(owner, nightId);
    const sequences = snapshot?.messages.map((message) => message.sequence) ?? [];
    expect(sequences).toHaveLength(HOUSE_CHAT_RECENT_LIMIT);
    expect(sequences[0]).toBe(3n);
    expect(sequences.at(-1)).toBe(BigInt(total));
    expect(sequences).toEqual([...sequences].sort((a, b) => Number(a - b)));
  });

  it('[BM-040] does not let a Member soft-delete at the persistence boundary', async () => {
    const member = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    await repository.post(member, {
      id: id(991),
      eventId: id(992),
      nightId,
      body: 'Stay on the rail',
      postedAt: new Date('2026-09-18T14:10:00.000Z'),
    });
    await expect(
      repository.softDelete(member, {
        eventId: id(993),
        nightId,
        messageId: id(991),
        deletedAt: new Date('2026-09-18T14:11:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.readRecent(member, nightId)).resolves.toMatchObject({
      messages: [expect.objectContaining({ id: id(991) })],
    });
  });

  it('[BM-040] enforces the plain-text length bound', async () => {
    await expect(
      database.query(
        `insert into house_messages
           (id, house_id, night_id, membership_id, body, sequence, created_at)
         values ($1, $2, $3, $4, $5, 1, now())`,
        [id(990), world.first.houseId, nightId, world.first.member.membershipId, 'x'.repeat(2001)],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'house_messages_body_check' });
  });
});
