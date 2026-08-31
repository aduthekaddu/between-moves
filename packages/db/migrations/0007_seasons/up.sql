-- [BM-018] [DR-SEASON-01..04] House-scoped Season lifecycle and Charter versions.
create table seasons (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 80),
  state text not null default 'draft'
    check (state in ('draft', 'active', 'closing', 'closed')),
  starts_at timestamptz null,
  ends_at timestamptz null,
  published_charter_version integer null,
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_lifecycle_fields_check check (
    (state = 'draft' and starts_at is null and ends_at is null
      and published_charter_version is null and closed_at is null)
    or
    (state in ('active', 'closing') and starts_at is not null and ends_at > starts_at
      and published_charter_version is not null and published_charter_version > 0
      and closed_at is null)
    or
    (state = 'closed' and starts_at is not null and ends_at > starts_at
      and published_charter_version is not null and published_charter_version > 0
      and closed_at is not null)
  )
);

create unique index seasons_one_active_or_closing_per_house
  on seasons (house_id)
  where state in ('active', 'closing');
create index seasons_house_state_idx on seasons (house_id, state);

create table season_charters (
  id uuid primary key check (is_uuid_v7(id)),
  season_id uuid not null references seasons(id) on delete cascade,
  version integer not null check (version > 0),
  correspondence_pace_hours integer not null check (correspondence_pace_hours > 0),
  night_recurrence jsonb not null check (jsonb_typeof(night_recurrence) = 'object'),
  points_recipe jsonb not null check (jsonb_typeof(points_recipe) = 'object'),
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint season_charters_season_version_unique unique (season_id, version)
);

alter table seasons
  add constraint seasons_published_charter_fk
  foreign key (id, published_charter_version)
  references season_charters (season_id, version)
  deferrable initially deferred;
