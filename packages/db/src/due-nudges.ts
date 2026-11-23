/**
 * [BM-029] The one definition of a still-due Nudge at `now`: each row is the recipient's open
 * turn, with the stage the clock gives. A queued Nudge is due while its key and `move_due_at` match a row.
 */
export function dueNudgesAt(now: `$${number}`): string {
  return `select g.id as game_id, g.house_id, g.current_ply as ply,
                 recipient.id as recipient_membership_id,
                 case when g.move_due_at <= ${now} then 'overdue' else 'advance' end as stage,
                 g.move_due_at
            from games g
            join houses house on house.id = g.house_id and house.status = 'active'
            join memberships recipient
              on recipient.id = case g.side_to_move
                   when 'white' then g.white_membership_id else g.black_membership_id end
             and recipient.house_id = g.house_id
             and recipient.status = 'active'
            join users recipient_user
              on recipient_user.id = recipient.user_id and recipient_user.status = 'active'
           where g.mode = 'correspondence' and g.state = 'active'
             and g.move_due_at is not null`;
}
