-- [BM-034] [DR-SCORE-01..08] Immutable, House-scoped Season points ledger.
alter table seasons add column outbox_sequence bigint not null default 0;
update seasons s
   set outbox_sequence = coalesce(
     (select max(event.sequence) from outbox_events event where event.aggregate_id=s.id),
     0
   );
alter table seasons add constraint seasons_outbox_sequence_check check (outbox_sequence >= 0);

-- A completion ordinal allocated under the Season row lock gives the eight-Game
-- cap a durable order that cannot change when consumers run concurrently.
alter table seasons add column game_completion_sequence bigint not null default 0;
alter table seasons add constraint seasons_game_completion_sequence_check
  check (game_completion_sequence >= 0);
alter table games add column season_completion_sequence bigint null;

with ranked as (
  select id,
         row_number() over (
           partition by season_id order by completed_at, id
         )::bigint as completion_sequence
    from games
   where state='completed' and completed_at is not null
)
update games game
   set season_completion_sequence=ranked.completion_sequence
  from ranked
 where game.id=ranked.id;

update seasons season
   set game_completion_sequence=coalesce((
     select max(game.season_completion_sequence)
       from games game
      where game.season_id=season.id
   ), 0);

alter table games add constraint games_season_completion_sequence_check
  check (season_completion_sequence is null or season_completion_sequence > 0);
alter table games add constraint games_season_completion_sequence_unique
  unique (season_id, season_completion_sequence);

create table season_score_ledger (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  season_id uuid not null,
  membership_id uuid not null,
  source_kind text not null,
  source_key text not null,
  points integer not null,
  created_at timestamptz not null default now(),
  constraint season_score_ledger_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete restrict,
  constraint season_score_ledger_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint season_score_ledger_source_kind_check check (
    source_kind in (
      'game_played', 'game_win', 'game_draw', 'night_attendance', 'puzzle_published'
    )
  ),
  constraint season_score_ledger_source_key_length_check
    check (char_length(source_key) between 1 and 200),
  constraint season_score_ledger_fixed_points_check check (
    (source_kind = 'game_win' and points = 3)
    or (source_kind = 'game_draw' and points = 2)
    or (source_kind not in ('game_win', 'game_draw') and points = 1)
  ),
  constraint season_score_ledger_source_unique
    unique (season_id, membership_id, source_key)
);

create index season_score_ledger_season_membership_idx
  on season_score_ledger (season_id, membership_id);
create index season_score_ledger_house_season_idx
  on season_score_ledger (house_id, season_id);

create function reject_season_score_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'season_score_ledger is immutable' using errcode = '55000';
end;
$$;

create trigger season_score_ledger_immutable
  before update or delete on season_score_ledger
  for each row execute function reject_season_score_ledger_mutation();
