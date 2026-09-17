import type { GameCompletionInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameCompletionRepository } from './pg-game-completion-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const charterId = '01941f29-7c00-7000-8000-000000000702';
const gameId = '01941f29-7c00-7000-8000-000000000703';
const completedAt = new Date('2026-09-10T08:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function input(command: number, targetGameId = gameId): GameCompletionInput {
  return {
    gameId: targetGameId,
    clientCommandId: id(800 + command),
    completedEventId: id(900 + command * 2),
    analysisEventId: id(901 + command * 2),
    completedAt: new Date(completedAt.getTime() + command * 1_000),
  };
}

function context(world: TwoHousesWithMembers, actor: 'white' | 'black' | 'spectator') {
  const viewerId =
    actor === 'white'
      ? world.first.member.userId
      : actor === 'black'
        ? world.first.nonOwner.userId
        : world.switchingMember.userId;
  return fakeAuthorizationContext({ viewerId, houseId: world.first.houseId });
}

async function createActiveGame(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1,$2,'Completion season','draft',$3,$3)`,
    [seasonId, world.first.houseId, completedAt],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [charterId, seasonId, completedAt],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, completedAt, new Date('2026-10-08T08:00:00.000Z')],
  );
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       clock_policy, move_due_at, created_at)
     values ($1,$2,$3,'correspondence','active',$4,$5,$6,$7,$7)`,
    [
      gameId,
      world.first.houseId,
      seasonId,
      world.first.member.membershipId,
      world.first.nonOwner.membershipId,
      { kind: 'correspondence', perMoveHours: 48 },
      completedAt,
    ],
  );
}

async function events(database: Pool) {
  return database.query(
    `select topic, sequence::text, payload from outbox_events
      where aggregate_id=$1 order by sequence`,
    [gameId],
  );
}

integration('PostgreSQL Game completion repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const repository = new PgGameCompletionRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createActiveGame(database, world);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-028] records the opponent as winner on resignation and emits both completion events', async () => {
    const command = input(1);

    await expect(repository.resign(context(world, 'white'), command)).resolves.toMatchObject({
      state: 'completed',
      result: 'black_win',
      resultReason: 'resign',
      completedAt: command.completedAt,
      completedNow: true,
    });
    await expect(
      database.query(
        `select state, result, result_reason, completed_at, version,
                season_completion_sequence::text
           from games where id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: 'completed',
          result: 'black_win',
          result_reason: 'resign',
          completed_at: command.completedAt,
          version: 1,
          season_completion_sequence: '1',
        },
      ],
    });
    await expect(events(database)).resolves.toMatchObject({
      rows: [
        { topic: 'game.completed', sequence: '1', payload: { result: 'black_win' } },
        { topic: 'game.analysis-requested', sequence: '2', payload: { result: 'black_win' } },
      ],
    });
  });

  it('[BM-034] serializes concurrent Game completions into a durable Season order', async () => {
    const secondGameId = id(704);
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, move_due_at, created_at)
       select $1, house_id, season_id, mode, state, white_membership_id, black_membership_id,
              clock_policy, move_due_at, created_at
         from games where id=$2`,
      [secondGameId, gameId],
    );

    await Promise.all([
      repository.resign(context(world, 'white'), input(20, gameId)),
      repository.resign(context(world, 'white'), input(21, secondGameId)),
    ]);

    await expect(
      database.query(
        `select season_completion_sequence::text as value
           from games where id in ($1,$2)
          order by season_completion_sequence`,
        [gameId, secondGameId],
      ),
    ).resolves.toMatchObject({ rows: [{ value: '1' }, { value: '2' }] });
  });

  it('[BM-028] [DR-DRAW-01/02] records and accepts a draw offer atomically', async () => {
    const offer = input(2);
    const accept = input(3);

    await expect(
      repository.draw(context(world, 'black'), { ...offer, action: 'offer' }),
    ).resolves.toMatchObject({
      state: 'active',
      pendingDrawOffer: { offeringMembershipId: world.first.nonOwner.membershipId, ply: 0 },
    });
    await expect(
      repository.draw(context(world, 'white'), { ...accept, action: 'accept' }),
    ).resolves.toMatchObject({
      state: 'completed',
      result: 'draw',
      resultReason: 'agreement',
      pendingDrawOffer: null,
      completedNow: true,
    });
    await expect(events(database)).resolves.toMatchObject({
      rows: [
        { topic: 'game.completed', sequence: '1', payload: { resultReason: 'agreement' } },
        {
          topic: 'game.analysis-requested',
          sequence: '2',
          payload: { resultReason: 'agreement' },
        },
      ],
    });
  });

  it('[BM-028] makes lifecycle commands idempotent without duplicating events', async () => {
    const command = input(4);
    const first = await repository.resign(context(world, 'black'), command);
    const replay = await repository.resign(context(world, 'black'), command);

    expect(first).toMatchObject({ result: 'white_win', completedNow: true, replayed: false });
    expect(replay).toMatchObject({ result: 'white_win', completedNow: false, replayed: true });
    await expect(events(database)).resolves.toMatchObject({ rowCount: 2 });
  });

  it('[BM-028] [DR-DRAW-02] replays the original offer after the Game advances', async () => {
    const command = input(13);
    const offered = await repository.draw(context(world, 'black'), {
      ...command,
      action: 'offer',
    });
    await database.query(
      `update games
          set current_ply=1, side_to_move='black', version=1,
              draw_offer_membership_id=null, draw_offer_ply=null
        where id=$1`,
      [gameId],
    );

    const replayed = await repository.draw(context(world, 'black'), {
      ...command,
      action: 'offer',
    });

    expect(replayed).toEqual({ ...offered, completedNow: false, replayed: true });
  });

  it('[BM-028] rolls back the result and command when completion event insertion fails', async () => {
    const command = input(10);
    await database.query(
      `insert into outbox_events
        (id, topic, aggregate_id, sequence, house_id, payload, available_at, created_at)
       values ($1,'seed.event',$2,1,null,'{}',$3,$3)`,
      [command.completedEventId, id(1_900), command.completedAt],
    );

    await expect(repository.resign(context(world, 'white'), command)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      database.query(
        `select g.state, g.result,
                (select count(*)::int from game_lifecycle_commands c where c.game_id=g.id) commands,
                (select count(*)::int from outbox_events o where o.aggregate_id=g.id) events
           from games g where g.id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [{ state: 'active', result: null, commands: 0, events: 0 }],
    });
  });

  it('[BM-028] [DR-SEC-01] denies non-seated and cross-House lifecycle commands', async () => {
    await expect(repository.resign(context(world, 'spectator'), input(5))).rejects.toMatchObject({
      code: 'authorization_denied',
    });
    await expect(
      repository.draw(context(world, 'spectator'), { ...input(11), action: 'offer' }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      repository.draw(context(world, 'spectator'), { ...input(12), action: 'accept' }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    const otherHouse = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    await expect(repository.resign(otherHouse, input(6))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(events(database)).resolves.toMatchObject({ rowCount: 0 });
  });

  it('[BM-028] [DR-DRAW-02] rejects self-acceptance and acceptance without an offer', async () => {
    await expect(
      repository.draw(context(world, 'white'), { ...input(7), action: 'accept' }),
    ).rejects.toMatchObject({ code: 'move_conflict' });
    await repository.draw(context(world, 'black'), { ...input(8), action: 'offer' });
    await expect(
      repository.draw(context(world, 'black'), { ...input(9), action: 'accept' }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
  });
});
