-- [BM-029] [DR-CORR-04] Durable natural key for advance/overdue Nudge delivery.
alter table games add column outbox_sequence bigint not null default 0;
update games g
   set outbox_sequence = greatest(
     g.version::bigint,
     coalesce((select max(event.sequence)
                 from outbox_events event
                where event.aggregate_id = g.id), 0)
   );
alter table games add constraint games_outbox_sequence_check check (outbox_sequence >= 0);

create table nudge_deliveries (
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  ply integer not null check (ply >= 0),
  recipient_membership_id uuid not null,
  stage text not null check (stage in ('advance', 'overdue')),
  move_due_at timestamptz not null,
  outbox_event_id uuid not null unique,
  created_at timestamptz not null,
  primary key (game_id, ply, recipient_membership_id, stage),
  constraint nudge_deliveries_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint nudge_deliveries_recipient_house_fk
    foreign key (recipient_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint nudge_deliveries_outbox_event_uuid_v7_check
    check (is_uuid_v7(outbox_event_id))
);

create index nudge_deliveries_house_created_idx
  on nudge_deliveries (house_id, created_at);
