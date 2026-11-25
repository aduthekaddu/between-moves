import {
  NUDGE_DUE_TOPIC,
  type DueNudge,
  type FindDueNudges,
  type NudgeOutboxEvent,
  type NudgeRepository,
  type NudgeStage,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { dueNudgesAt } from './due-nudges';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

interface DueNudgeRow extends QueryResultRow {
  game_id: string;
  house_id: string;
  ply: number;
  recipient_membership_id: string;
  stage: NudgeStage;
  move_due_at: Date;
}

function parseDue(row: DueNudgeRow): DueNudge {
  if (
    !row.game_id ||
    !row.house_id ||
    !Number.isInteger(row.ply) ||
    row.ply < 0 ||
    !row.recipient_membership_id ||
    (row.stage !== 'advance' && row.stage !== 'overdue') ||
    !(row.move_due_at instanceof Date)
  ) {
    throw new Error('Invalid due Nudge row');
  }
  return {
    gameId: row.game_id,
    houseId: row.house_id,
    ply: row.ply,
    recipientMembershipId: row.recipient_membership_id,
    stage: row.stage,
    moveDueAt: row.move_due_at,
  };
}

async function lockCurrentNudge(client: PoolClient, nudge: DueNudge, now: Date): Promise<boolean> {
  await client.query('select 1 from games where id = $1 and house_id = $2 for update', [
    nudge.gameId,
    nudge.houseId,
  ]);
  const result = await client.query(
    `select 1 from (${dueNudgesAt('$1')}) due
      where due.game_id = $2 and due.house_id = $3 and due.ply = $4
        and due.recipient_membership_id = $5 and due.stage = $6 and due.move_due_at = $7`,
    [
      now,
      nudge.gameId,
      nudge.houseId,
      nudge.ply,
      nudge.recipientMembershipId,
      nudge.stage,
      nudge.moveDueAt,
    ],
  );
  return result.rowCount === 1;
}

/** [BM-029] PostgreSQL scan and atomic Nudge/outbox natural-key adapter. */
export class PgNudgeRepository implements NudgeRepository {
  constructor(private readonly database: Pool) {}

  async findDue(request: FindDueNudges): Promise<readonly DueNudge[]> {
    const result = await this.database.query<DueNudgeRow>(
      `select due.*
         from (${dueNudgesAt('$1')}) due
        where due.move_due_at <= $2
          and not exists (
            select 1 from nudge_deliveries delivery
             where delivery.game_id = due.game_id
               and delivery.ply = due.ply
               and delivery.recipient_membership_id = due.recipient_membership_id
               and delivery.stage = due.stage
          )
        order by due.move_due_at, due.game_id, due.stage
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
