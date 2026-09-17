-- [BM-036] [DR-NIGHT-02] Append-only server-timestamped Night join/leave events.
create table night_attendance_events (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  attendance_id uuid not null,
  night_id uuid not null,
  membership_id uuid not null,
  kind text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  constraint night_attendance_events_id_house_unique unique (id, house_id),
  constraint night_attendance_events_attendance_house_fk
    foreign key (attendance_id, house_id)
    references night_attendance (id, house_id) on delete cascade,
  constraint night_attendance_events_night_house_fk
    foreign key (night_id, house_id)
    references house_nights (id, house_id) on delete cascade,
  constraint night_attendance_events_membership_house_fk
    foreign key (membership_id, house_id)
    references memberships (id, house_id) on delete restrict,
  constraint night_attendance_events_kind_check check (kind in ('join', 'leave'))
);

create index night_attendance_events_house_night_idx
  on night_attendance_events (house_id, night_id);
create index night_attendance_events_attendance_occurred_idx
  on night_attendance_events (attendance_id, occurred_at);
create index night_attendance_events_membership_idx
  on night_attendance_events (membership_id, night_id);
