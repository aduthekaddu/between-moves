-- [BM-047] Finalized Season standings captured once when a Season enters `closing`.
create table season_final_standings (
  season_id uuid not null,
  house_id uuid not null,
  membership_id uuid not null,
  rank integer not null check (rank > 0),
  points integer not null check (points >= 0),
  finalized_at timestamptz not null,
  constraint season_final_standings_pkey primary key (season_id, membership_id),
  constraint season_final_standings_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete cascade,
  constraint season_final_standings_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict
);

create index season_final_standings_house_season_rank_idx
  on season_final_standings (house_id, season_id, rank);

-- Rows are written once in the closing transaction. Deletion is left to the Season cascade.
create function reject_season_final_standings_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'season_final_standings is immutable' using errcode = '55000';
end;
$$;

create trigger season_final_standings_immutable
  before update on season_final_standings
  for each row execute function reject_season_final_standings_update();
