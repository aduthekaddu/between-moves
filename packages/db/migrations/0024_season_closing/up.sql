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

-- Rows are written once, while the Season row is still `active`, in the same transaction
-- that moves it to `closing`. After that the snapshot is frozen: updates are always
-- rejected, inserts need an `active` parent, and deletes are allowed only through the
-- Season `on delete cascade` (the parent row is already gone when the cascade runs).
create function guard_season_final_standings()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'season_final_standings is immutable' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from seasons
       where id = new.season_id and house_id = new.house_id and state = 'active'
    ) then
      raise exception 'season_final_standings is frozen once a Season leaves active'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if exists (select 1 from seasons where id = old.season_id) then
    raise exception 'season_final_standings is immutable' using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger season_final_standings_immutable
  before insert or update or delete on season_final_standings
  for each row execute function guard_season_final_standings();
