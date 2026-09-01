-- [BM-020] [DR-NIGHT-01/03] Materialized, House-scoped Between Moves Night schedule.
alter table seasons
  add constraint seasons_id_house_unique unique (id, house_id);

alter table memberships
  add constraint memberships_id_house_unique unique (id, house_id);

create table house_nights (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  season_id uuid not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'live', 'ended', 'cancelled')),
  host_membership_id uuid null,
  started_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint house_nights_interval_check check (scheduled_end > scheduled_start),
  constraint house_nights_season_start_unique unique (season_id, scheduled_start),
  constraint house_nights_id_house_unique unique (id, house_id),
  constraint house_nights_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete cascade,
  constraint house_nights_host_house_fk foreign key (host_membership_id, house_id)
    references memberships(id, house_id) on delete restrict
);

create index house_nights_house_schedule_idx on house_nights (house_id, scheduled_start);
create index house_nights_season_state_idx on house_nights (season_id, state);

-- Privileged schedule edits are append-only and share the edit transaction.
create table night_audit (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  night_id uuid not null,
  actor_membership_id uuid not null,
  action text not null check (action in ('rescheduled', 'cancelled')),
  previous_scheduled_start timestamptz not null,
  previous_scheduled_end timestamptz not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  created_at timestamptz not null,
  constraint night_audit_previous_interval_check
    check (previous_scheduled_end > previous_scheduled_start),
  constraint night_audit_interval_check check (scheduled_end > scheduled_start),
  constraint night_audit_night_house_fk foreign key (night_id, house_id)
    references house_nights(id, house_id) on delete cascade,
  constraint night_audit_actor_house_fk foreign key (actor_membership_id, house_id)
    references memberships(id, house_id) on delete restrict
);

create index night_audit_house_created_idx on night_audit (house_id, created_at);
create index night_audit_night_created_idx on night_audit (night_id, created_at);
