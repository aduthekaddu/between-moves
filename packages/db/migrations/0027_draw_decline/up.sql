-- [BM-028] [DR-DRAW-02] A declined draw offer is an idempotent lifecycle command like the others.
alter table game_lifecycle_commands drop constraint game_lifecycle_commands_action_check;
alter table game_lifecycle_commands
  add constraint game_lifecycle_commands_action_check
  check (action in ('resign', 'draw_offer', 'draw_accept', 'draw_decline'));
