import {
  NUDGE_DUE_TOPIC,
  type DueNudge,
  type FindDueNudges,
  type NudgeOutboxEvent,
  type NudgeRepository,
  type NudgeStage,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

interface DueNudgeRow extends QueryResultRow {
  game_id: string;
  house_id: string;
  current_ply: number;
  recipient_membership_id: string;
  stage: NudgeStage;
  move_due_at: Date;
}

function parseDue(row: DueNudgeRow): DueNudge {
  if (
    !row.game_id ||
    !row.house_id ||
    !Number.isInteger(row.current_ply) ||
    row.current_ply < 0 ||
    !row.recipient_membership_id ||
    (row.stage !== 'advance' && row.stage !== 'overdue') ||
    !(row.move_due_at instanceof Date)
  ) {
    throw new Error('Invalid due Nudge row');
  }
  return {
    gameId: row.game_id,
    houseId: row.house_id,
    ply: row.current_ply,
    recipientMembershipId: row.recipient_membership_id,
    stage: row.stage,
    moveDueAt: row.move_due_at,
  };
}

async function lockCurrentNudge(client: PoolClient, nudge: DueNudge, now: Date): Promise<boolean> {
  const result = await client.query(
    `select 1
       from games g
       join memberships recipient
         on recipient.id = case g.side_to_move
              when 'white' then g.white_membership_id else g.black_membership_id end
        and recipient.house_id = g.house_id
        and recipient.status = 'active'
      where g.id = $1 and g.house_id = $2
        and g.mode = 'correspondence' and g.state = 'active'
        and g.current_ply = $3 and recipient.id = $4
        and g.move_due_at = $5
        and (($6 = 'advance' and g.move_due_at > $7)
          or ($6 = 'overdue' and g.move_due_at <= $7))
      for update of g`,
    [
      nudge.gameId,
      nudge.houseId,
      nudge.ply,
      nudge.recipientMembershipId,
      nudge.moveDueAt,
      nudge.stage,
      now,
    ],
  );
  return result.rowCount === 1;
}

/** [BM-029] PostgreSQL scan and atomic Nudge/outbox natural-key adapter. */
export class PgNudgeRepository implements NudgeRepository {
  constructor(private readonly database: Pool) {}

  async findDue(request: FindDueNudges): Promise<readonly DueNudge[]> {
    const result = await this.database.query<DueNudgeRow>(
      `with candidates as (
         select g.id as game_id, g.house_id, g.current_ply,
                case g.side_to_move when 'white' then g.white_membership_id
                     else g.black_membership_id end as recipient_membership_id,
                case when g.move_due_at <= $1 then 'overdue' else 'advance' end as stage,
                g.move_due_at
           from games g
           join memberships recipient
             on recipient.id = case g.side_to_move
                  when 'white' then g.white_membership_id else g.black_membership_id end
            and recipient.house_id = g.house_id
            and recipient.status = 'active'
          where g.mode = 'correspondence' and g.state = 'active'
            and g.move_due_at is not null and g.move_due_at <= $2
       )
       select candidate.*
         from candidates candidate
        where not exists (
          select 1 from nudge_deliveries delivery
           where delivery.game_id = candidate.game_id
             and delivery.ply = candidate.current_ply
             and delivery.recipient_membership_id = candidate.recipient_membership_id
             and delivery.stage = candidate.stage
        )
        order by candidate.move_due_at, candidate.game_id, candidate.stage
        limit $3`,
      [request.now, request.advanceCutoff, request.limit],
    );
    return result.rows.map(parseDue);
  }

  async enqueue(nudge: DueNudge, event: NudgeOutboxEvent): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      if (!(await lockCurrentNudge(client, nudge, event.occurredAt))) {
        await client.query('rollback');
        return false;
      }
      const inserted = await client.query(
        `insert into nudge_deliveries
          (game_id, house_id, ply, recipient_membership_id, stage, move_due_at,
           outbox_event_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (game_id, ply, recipient_membership_id, stage) do nothing
         returning game_id`,
        [
          nudge.gameId,
          nudge.houseId,
          nudge.ply,
          nudge.recipientMembershipId,
          nudge.stage,
          nudge.moveDueAt,
          event.id,
          event.occurredAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query('commit');
        return false;
      }
      const sequenceResult = await client.query<{ outbox_sequence: string }>(
        `update games set outbox_sequence = outbox_sequence + 1
          where id = $1 and house_id = $2
        returning outbox_sequence::text`,
        [nudge.gameId, nudge.houseId],
      );
      const sequence = sequenceResult.rows[0]?.outbox_sequence;
      if (sequence === undefined || !/^\d+$/.test(sequence)) {
        throw new Error('Invalid Game outbox sequence');
      }
      await enqueueOutboxEvent(
        {
          ...event,
          topic: NUDGE_DUE_TOPIC,
          aggregateId: nudge.gameId,
          sequence: BigInt(sequence),
          houseId: nudge.houseId,
          payload: {
            recipientMembershipId: nudge.recipientMembershipId,
            ply: nudge.ply,
            stage: nudge.stage,
          },
        },
        client,
      );
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
