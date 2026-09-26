-- [BM-045] Private, reviewable puzzle moments derived from completed analysis.
alter table analysis_jobs add constraint analysis_jobs_id_house_unique unique (id, house_id);

create table puzzle_candidates (
  id uuid primary key default gen_random_uuid(),
  analysis_job_id uuid not null,
  game_id uuid not null,
  house_id uuid not null,
  season_id uuid not null,
  source_ply integer not null check (source_ply > 0),
  position_fen text not null check (char_length(position_fen) between 1 and 200),
  best_line jsonb not null check (jsonb_typeof(best_line) = 'array'),
  evaluation_swing_cp integer not null check (evaluation_swing_cp >= 200),
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'rejected')),
  reviewer_membership_id uuid,
  created_at timestamptz not null default now(),
  constraint puzzle_candidates_analysis_job_house_fk foreign key (analysis_job_id, house_id)
    references analysis_jobs(id, house_id) on delete cascade,
  constraint puzzle_candidates_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint puzzle_candidates_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete restrict,
  constraint puzzle_candidates_reviewer_house_fk foreign key (reviewer_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint puzzle_candidates_game_ply_unique unique (game_id, source_ply)
);

create index puzzle_candidates_house_season_state_idx
  on puzzle_candidates (house_id, season_id, state, created_at desc);
