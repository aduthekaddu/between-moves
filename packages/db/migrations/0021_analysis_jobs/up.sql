-- [BM-044] Analysis is queued after completion and retried independently.
create table analysis_jobs (
  id uuid primary key,
  source_event_id uuid not null constraint analysis_jobs_source_event_id_unique unique,
  game_id uuid not null,
  house_id uuid not null,
  engine_version text not null check (char_length(engine_version) between 1 and 100),
  state text not null default 'pending' check (state in ('pending', 'leased', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  result jsonb,
  last_error text,
  last_failure_token uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint analysis_jobs_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint analysis_jobs_lease_shape_check check (
    (state = 'leased' and lease_token is not null and lease_until is not null)
    or (state <> 'leased' and lease_token is null and lease_until is null)
  ),
  constraint analysis_jobs_completion_shape_check check (
    (state = 'completed' and result is not null and completed_at is not null)
    or (state <> 'completed' and result is null and completed_at is null)
  ),
  constraint analysis_jobs_error_length_check check (
    last_error is null or char_length(last_error) between 1 and 2000
  )
);

create index analysis_jobs_claim_idx on analysis_jobs (available_at, id)
  where state in ('pending', 'leased');
