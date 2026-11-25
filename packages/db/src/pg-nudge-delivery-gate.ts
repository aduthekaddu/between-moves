import {
  NUDGE_DUE_TOPIC,
  type ClaimedOutboxEvent,
  type NudgeDeliveryGate,
  type NudgeEmail,
  type NudgeStage,
  type VerifiedNudgeDelivery,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';
import { dueNudgesAt } from './due-nudges';

interface NudgeEmailRow extends QueryResultRow {
  email: string;
  house_id: string;
  house_name: string;
  opponent_name: string;
  last_move_san: string | null;
  move_due_at: Date;
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

/** [BM-029] Issues a `VerifiedNudgeDelivery` only while the Nudge is still due; holds no lock across the send. */
export class PgNudgeDeliveryGate implements NudgeDeliveryGate {
  constructor(private readonly database: Pool) {}

  async pass(event: ClaimedOutboxEvent, now: Date): Promise<VerifiedNudgeDelivery | null> {
    const payload = eventPayload(event);
    const result = await this.database.query<NudgeEmailRow>(
      `select u.email::text, h.id::text as house_id, h.name as house_name,
              coalesce(opponent.display_name_snapshot, opponent_user.display_name) as opponent_name,
              (select mv.san from moves mv
                where mv.house_id = g.house_id and mv.game_id = g.id
                  and mv.ply = delivery.ply) as last_move_san,
              delivery.move_due_at
         from nudge_deliveries delivery
         join (${dueNudgesAt('$1')}) due
           on due.game_id = delivery.game_id and due.house_id = delivery.house_id
          and due.ply = delivery.ply
          and due.recipient_membership_id = delivery.recipient_membership_id
          and due.stage = delivery.stage and due.move_due_at = delivery.move_due_at
         join houses h on h.id = delivery.house_id
         join memberships m on m.id = delivery.recipient_membership_id
         join users u on u.id = m.user_id
         join games g on g.id = delivery.game_id and g.house_id = delivery.house_id
         join memberships opponent
           on opponent.house_id = g.house_id
          and opponent.id = case when g.white_membership_id = delivery.recipient_membership_id
                                 then g.black_membership_id else g.white_membership_id end
         join users opponent_user on opponent_user.id = opponent.user_id
        where delivery.outbox_event_id = $2 and delivery.game_id = $3
          and delivery.house_id = $4 and delivery.ply = $5
          and delivery.recipient_membership_id = $6 and delivery.stage = $7`,
      [
        now,
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
    const delivery = {
      email: row.email,
      houseId: row.house_id,
      houseName: row.house_name,
      gameId: event.aggregateId,
      ply: payload.ply,
      stage: payload.stage,
      opponentName: row.opponent_name,
      lastMoveSan: row.last_move_san,
      moveDueAt: row.move_due_at,
    } satisfies NudgeEmail;
    return delivery as VerifiedNudgeDelivery;
  }
}
