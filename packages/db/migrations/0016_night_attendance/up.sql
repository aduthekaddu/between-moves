-- [BM-033] [DR-NIGHT-02/05] Durable, House-scoped Night attendance intervals.
create table night_attendance (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  night_id uuid not null,
  membership_id uuid not null,
  first_joined_at timestamptz not null,
  current_joined_at timestamptz null,
  last_left_at timestamptz null,
  accumulated_seconds integer not null default 0,
  qualified_at timestamptz null,
  qualification_reason text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint night_attendance_night_membership_unique unique (night_id, membership_id),
  constraint night_attendance_id_house_unique unique (id, house_id),
  constraint night_attendance_night_house_fk foreign key (night_id, house_id)
    references house_nights(id, house_id) on delete cascade,
  constraint night_attendance_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint night_attendance_accumulated_check check (accumulated_seconds >= 0),
  constraint night_attendance_current_join_check check (
    current_joined_at is null or current_joined_at >= first_joined_at
  ),
  constraint night_attendance_last_leave_check check (
    last_left_at is null or last_left_at >= first_joined_at
  ),
  constraint night_attendance_qualification_pair_check check (
    (qualified_at is null) = (qualification_reason is null)
  ),
  constraint night_attendance_qualification_reason_check check (
    qualification_reason is null
    or qualification_reason in ('duration', 'completed_live_game')
  ),
  constraint night_attendance_qualified_at_check check (
    qualified_at is null or qualified_at >= first_joined_at
  )
);

create index night_attendance_house_night_idx
  on night_attendance (house_id, night_id);
create index night_attendance_membership_idx
  on night_attendance (membership_id, night_id);
