-- [BM-028] [DR-DRAW-01/02] Persist one transient draw offer and idempotent lifecycle commands.
alter table games add column draw_offer_membership_id uuid null;
alter table games add column draw_offer_ply integer null;
alter table games add constraint games_draw_offer_membership_house_fk
  foreign key (draw_offer_membership_id, house_id)
  references memberships(id, house_id) on delete restrict;
alter table games add constraint games_draw_offer_shape_check check (
  (draw_offer_membership_id is null and draw_offer_ply is null)
  or
  (state = 'active' and draw_offer_membership_id is not null
    and draw_offer_membership_id in (white_membership_id, black_membership_id)
    and draw_offer_ply = current_ply and draw_offer_ply >= 0)
);

create table game_lifecycle_commands (
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  actor_membership_id uuid not null,
  client_command_id uuid not null,
  action text not null check (action in ('resign', 'draw_offer', 'draw_accept')),
  command_ply integer not null check (command_ply >= 0),
  outcome jsonb not null,
  created_at timestamptz not null,
  primary key (game_id, client_command_id),
  constraint game_lifecycle_commands_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint game_lifecycle_commands_actor_house_fk foreign key (actor_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint game_lifecycle_commands_client_command_uuid_v7_check
    check (is_uuid_v7(client_command_id))
);

create index game_lifecycle_commands_house_game_idx
  on game_lifecycle_commands (house_id, game_id);
