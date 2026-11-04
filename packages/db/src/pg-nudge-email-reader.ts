import {
  NUDGE_DUE_TOPIC,
  type ClaimedOutboxEvent,
  type NudgeEmail,
  type NudgeEmailReader,
  type NudgeStage,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface NudgeEmailRow extends QueryResultRow {
  email: string;
  house_id: string;
  house_name: string;
  opponent_name: string;
  last_move_san: string | null;
  move_due_at: Date | null;
}

function eventPayload(event: ClaimedOutboxEvent): {
  recipientMembershipId: string;
  ply: number;
  stage: NudgeStage;
} {
  const { recipientMembershipId, ply, stage } = event.payload;
  if (
    event.topic !== NUDGE_DUE_TOPIC ||
    typeof recipientMembershipId !== 'string' ||
    !Number.isInteger(ply) ||
    Number(ply) < 0 ||
    (stage !== 'advance' && stage !== 'overdue')
  ) {
    throw new Error('Invalid Nudge outbox event');
  }
  return { recipientMembershipId, ply: Number(ply), stage };
}

/** [BM-029] Resolves confidential email only inside the trusted Delivery seam. */
export class PgNudgeEmailReader implements NudgeEmailReader {
  constructor(private readonly database: Pool) {}

  async readForDelivery(event: ClaimedOutboxEvent): Promise<NudgeEmail | null> {
    const payload = eventPayload(event);
    const result = await this.database.query<NudgeEmailRow>(
      `select u.email::text, h.id::text as house_id, h.name as house_name,
              coalesce(opponent.display_name_snapshot, opponent_user.display_name) as opponent_name,
              (select mv.san from moves mv
                where mv.house_id = g.house_id and mv.game_id = g.id
                order by mv.ply desc limit 1) as last_move_san,
              g.move_due_at
         from nudge_deliveries delivery
         join houses h on h.id = delivery.house_id and h.status = 'active'
         join memberships m on m.id = delivery.recipient_membership_id
                           and m.house_id = delivery.house_id and m.status = 'active'
         join users u on u.id = m.user_id and u.status = 'active'
         join games g on g.id = delivery.game_id and g.house_id = delivery.house_id
         join memberships opponent
           on opponent.house_id = g.house_id
          and opponent.id = case when g.white_membership_id = delivery.recipient_membership_id
                                 then g.black_membership_id else g.white_membership_id end
         join users opponent_user on opponent_user.id = opponent.user_id
        where delivery.outbox_event_id = $1 and delivery.game_id = $2
          and delivery.house_id = $3 and delivery.ply = $4
          and delivery.recipient_membership_id = $5 and delivery.stage = $6`,
      [
        event.id,
        event.aggregateId,
        event.houseId,
        payload.ply,
        payload.recipientMembershipId,
        payload.stage,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    if (!row.email || !row.house_name || !row.opponent_name) {
      throw new Error('Invalid Nudge email row');
    }
    return {
      email: row.email,
      houseId: row.house_id,
      houseName: row.house_name,
      gameId: event.aggregateId,
      ply: payload.ply,
      stage: payload.stage,
      opponentName: row.opponent_name,
      lastMoveSan: row.last_move_san,
      moveDueAt: row.move_due_at,
    };
  }
}
