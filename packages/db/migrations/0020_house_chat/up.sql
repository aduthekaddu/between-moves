-- [BM-040] Durable-first House chat for Between Moves Nights.
alter table house_nights
  add column chat_sequence bigint not null default 0
    constraint house_nights_chat_sequence_check check (chat_sequence >= 0);

create table house_messages (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  night_id uuid not null,
  membership_id uuid not null,
  body text not null,
  sequence bigint not null,
  created_at timestamptz not null,
  deleted_at timestamptz null,
  deleted_by_membership_id uuid null,
  constraint house_messages_id_house_unique unique (id, house_id),
  constraint house_messages_night_house_fk foreign key (night_id, house_id)
    references house_nights(id, house_id) on delete cascade,
  constraint house_messages_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint house_messages_deleted_by_house_fk foreign key (deleted_by_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint house_messages_night_sequence_unique unique (night_id, sequence),
  constraint house_messages_body_check check (char_length(body) between 1 and 2000),
  constraint house_messages_sequence_check check (sequence > 0),
  constraint house_messages_deletion_state_check check (
    (deleted_at is null and deleted_by_membership_id is null)
    or (deleted_at is not null and deleted_by_membership_id is not null)
  )
);

create index house_messages_night_recent_idx
  on house_messages (house_id, night_id, sequence desc);
