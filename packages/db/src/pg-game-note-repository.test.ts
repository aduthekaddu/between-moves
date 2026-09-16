import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgGameNoteRepository } from './pg-game-note-repository';

const context = fakeAuthorizationContext({
  houseId: '01941f29-7c00-7000-8000-000000000601',
  viewerId: '01941f29-7c00-7000-8000-000000000101',
});
const gameId = '01941f29-7c00-7000-8000-000000000701';
const membershipId = '01941f29-7c00-7000-8000-000000000201';

interface TestNoteRow {
  readonly current_membership_id?: unknown;
  readonly membership_id: unknown;
  readonly author_display_name: unknown;
  readonly body: unknown;
  readonly created_at: unknown;
  readonly edited_at: unknown;
}

function database(rows: readonly TestNoteRow[]) {
  const query = vi.fn().mockResolvedValue({ rows: [...rows], rowCount: rows.length });
  return { pool: { query } as unknown as Pool, query };
}

function row(overrides: Partial<TestNoteRow> = {}): TestNoteRow {
  return {
    current_membership_id: membershipId,
    membership_id: membershipId,
    author_display_name: 'Ada',
    body: 'A sharp finish',
    created_at: new Date('2026-09-16T08:00:00.000Z'),
    edited_at: null,
    ...overrides,
  };
}

describe('PostgreSQL Game-note repository mapping', () => {
  it('[BM-032] [DR-NOTE-01] maps a created note and forwards House scope', async () => {
    const savedAt = new Date('2026-09-16T08:01:00.000Z');
    const { pool, query } = database([row()]);

    await expect(
      new PgGameNoteRepository(pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000702',
        gameId,
        body: 'A sharp finish',
        savedAt,
      }),
    ).resolves.toEqual({
      membershipId,
      authorDisplayName: 'Ada',
      body: 'A sharp finish',
      createdAt: new Date('2026-09-16T08:00:00.000Z'),
      editedAt: null,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('where g.house_id = $1'), [
      context.houseId,
      gameId,
      context.viewerId,
      '01941f29-7c00-7000-8000-000000000702',
      'A sharp finish',
      savedAt,
    ]);
  });

  it('[BM-032] [DR-NOTE-01] maps edited timestamps and filters empty left joins on read', async () => {
    const createdAt = '2026-09-16T08:00:00.000Z';
    const editedAt = '2026-09-16T08:05:00.000Z';
    const { pool, query } = database([
      row({ created_at: createdAt, edited_at: editedAt }),
      row({ membership_id: null, author_display_name: null, body: null }),
    ]);

    await expect(new PgGameNoteRepository(pool).readForGame(context, gameId)).resolves.toEqual({
      currentMembershipId: membershipId,
      notes: [
        {
          membershipId,
          authorDisplayName: 'Ada',
          body: 'A sharp finish',
          createdAt: new Date(createdAt),
          editedAt: new Date(editedAt),
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('left join game_notes'), [
      context.houseId,
      gameId,
      context.viewerId,
    ]);
  });

  it('[BM-032] maps a missing saved Game to a not-found domain error', async () => {
    const { pool } = database([]);

    await expect(
      new PgGameNoteRepository(pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000703',
        gameId,
        body: 'Unavailable',
        savedAt: new Date('2026-09-16T08:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('[BM-032] returns no view when a completed Game is outside the query scope', async () => {
    const { pool } = database([]);

    await expect(new PgGameNoteRepository(pool).readForGame(context, gameId)).resolves.toBeNull();
  });

  it('[BM-032] rejects malformed rows and timestamps instead of exposing invalid notes', async () => {
    const malformed = database([row({ membership_id: null })]);
    await expect(
      new PgGameNoteRepository(malformed.pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000704',
        gameId,
        body: 'Malformed',
        savedAt: new Date('2026-09-16T08:00:00.000Z'),
      }),
    ).rejects.toThrow('Invalid Game note row');

    const invalidDate = database([row({ created_at: 'not-a-date' })]);
    await expect(
      new PgGameNoteRepository(invalidDate.pool).save(context, {
        id: '01941f29-7c00-7000-8000-000000000705',
        gameId,
        body: 'Invalid timestamp',
        savedAt: new Date('2026-09-16T08:00:00.000Z'),
      }),
    ).rejects.toThrow('Invalid Game note created timestamp');

    const invalidMembership = database([row({ current_membership_id: 42 })]);
    await expect(
      new PgGameNoteRepository(invalidMembership.pool).readForGame(context, gameId),
    ).rejects.toThrow('Invalid current Game note membership');
  });
});
