-- [BM-035] [DR-NIGHT-01/03] Server-timestamped Night start/end and RSVP.
alter table house_nights
  add constraint house_nights_lifecycle_times_check check (
    (
      state in ('scheduled', 'cancelled')
      and started_at is null
      and ended_at is null
    )
    or (
      state = 'live'
      and started_at is not null
      and ended_at is null
    )
    or (
      state = 'ended'
      and started_at is not null
      and ended_at is not null
      and ended_at >= started_at
    )
  );

create table night_rsvps (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  night_id uuid not null,
  membership_id uuid not null,
  status text not null,
  responded_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint night_rsvps_night_membership_unique unique (night_id, membership_id),
  constraint night_rsvps_id_house_unique unique (id, house_id),
  constraint night_rsvps_night_house_fk foreign key (night_id, house_id)
    references house_nights(id, house_id) on delete cascade,
  constraint night_rsvps_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint night_rsvps_status_check check (status in ('going', 'not_going'))
);

create index night_rsvps_house_night_idx on night_rsvps (house_id, night_id);
create index night_rsvps_membership_idx on night_rsvps (membership_id, night_id);
