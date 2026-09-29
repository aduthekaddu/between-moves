-- Non-production reversal: declined-offer command rows cannot satisfy the narrower check.
delete from game_lifecycle_commands where action = 'draw_decline';
alter table game_lifecycle_commands drop constraint game_lifecycle_commands_action_check;
alter table game_lifecycle_commands
  add constraint game_lifecycle_commands_action_check
  check (action in ('resign', 'draw_offer', 'draw_accept'));
