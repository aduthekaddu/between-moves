import type {
  AuthorizationContext,
  MoveShelf,
  MoveShelfActiveGame,
  MoveShelfCompletedGame,
  MoveShelfReadRepository,
  MoveShelfResult,
  MoveShelfYourMoveGame,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

type ShelfGroup = 'your_move' | 'waiting' | 'recent';

interface MoveShelfRow extends QueryResultRow {
  readonly viewer_membership_id: unknown;
  readonly game_id: unknown;
  readonly shelf_group: unknown;
  readonly opponent_name: unknown;
  readonly current_ply: unknown;
  readonly move_due_at: unknown;
  readonly result: unknown;
  readonly completed_at: unknown;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Move Shelf ${field}`);
  return value;
}

function parseDate(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(parseString(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Move Shelf ${field}`);
  return parsed;
}

function parsePly(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid Move Shelf ply');
  }
  return value;
}

function parseGroup(value: unknown): ShelfGroup {
  switch (value) {
    case 'your_move':
    case 'waiting':
    case 'recent':
      return value;
    default:
      throw new Error('Invalid Move Shelf group');
  }
}

function parseResult(value: unknown): MoveShelfResult {
  switch (value) {
    case 'white_win':
    case 'black_win':
    case 'draw':
    case 'aborted':
      return value;
    default:
      throw new Error('Invalid Move Shelf result');
  }
}

function parseActiveGame(row: MoveShelfRow): MoveShelfActiveGame {
  return {
    gameId: parseString(row.game_id, 'Game id'),
    opponentName: parseString(row.opponent_name, 'opponent name'),
    moveDueAt: parseDate(row.move_due_at, 'Move deadline'),
  };
}

function parseYourMoveGame(row: MoveShelfRow): MoveShelfYourMoveGame {
  return { ...parseActiveGame(row), ply: parsePly(row.current_ply) };
}

function parseCompletedGame(row: MoveShelfRow): MoveShelfCompletedGame {
  return {
    gameId: parseString(row.game_id, 'Game id'),
    opponentName: parseString(row.opponent_name, 'opponent name'),
    result: parseResult(row.result),
    completedAt: parseDate(row.completed_at, 'completion time'),
  };
}

/** [BM-026] [DR-SHELF-01] Read ordered correspondence groups through one tenant predicate. */
export class PgMoveShelfRepository implements MoveShelfReadRepository {
  constructor(private readonly database: Pool) {}

  async readMoveShelf(context: AuthorizationContext): Promise<MoveShelf | null> {
    const result = await this.database.query<MoveShelfRow>(
      `with viewer_membership as (
         select membership.id
           from memberships membership
           join houses house
             on house.id = membership.house_id
            and house.status = 'active'
          where membership.house_id = $1
            and membership.user_id = $2
            and membership.status = 'active'
          limit 1
       )
       select vm.id::text as viewer_membership_id,
              g.id::text as game_id,
              case
                when g.state = 'completed' then 'recent'
                when (g.white_membership_id = vm.id and g.side_to_move = 'white')
                  or (g.black_membership_id = vm.id and g.side_to_move = 'black')
                  then 'your_move'
                else 'waiting'
              end as shelf_group,
              coalesce(opponent.display_name_snapshot, opponent_user.display_name) as opponent_name,
              g.current_ply,
              g.move_due_at,
              g.result,
              g.completed_at
         from viewer_membership vm
         left join games g
           on g.house_id = $1
          and g.mode = 'correspondence'
          and (g.white_membership_id = vm.id or g.black_membership_id = vm.id)
          and ((g.state = 'active' and g.move_due_at is not null)
            or (g.state = 'completed' and g.completed_at is not null and g.result is not null))
         left join memberships opponent
           on opponent.house_id = g.house_id
          and opponent.id = case
            when g.white_membership_id = vm.id then g.black_membership_id
            else g.white_membership_id
          end
         left join users opponent_user on opponent_user.id = opponent.user_id
        order by case
                   when g.id is null then 3
                   when g.state = 'active'
                    and ((g.white_membership_id = vm.id and g.side_to_move = 'white')
                      or (g.black_membership_id = vm.id and g.side_to_move = 'black')) then 0
                   when g.state = 'active' then 1
                   else 2
                 end,
                 case when g.state = 'active' then g.move_due_at end asc nulls last,
                 case when g.state = 'completed' then g.completed_at end desc nulls last,
                 g.id asc`,
      [context.houseId, context.viewerId],
    );

    if (result.rows.length === 0) return null;

    const shelf: {
      yourMove: MoveShelfYourMoveGame[];
      waiting: MoveShelfActiveGame[];
      recent: MoveShelfCompletedGame[];
    } = { yourMove: [], waiting: [], recent: [] };

    for (const row of result.rows) {
      parseString(row.viewer_membership_id, 'viewer membership id');
      if (row.game_id === null) continue;

      const group = parseGroup(row.shelf_group);
      if (group === 'your_move') shelf.yourMove.push(parseYourMoveGame(row));
      else if (group === 'waiting') shelf.waiting.push(parseActiveGame(row));
      else shelf.recent.push(parseCompletedGame(row));
    }

    return shelf;
  }
}
