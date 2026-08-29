-- [BM-006] DR-DELIV-01 transactional outbox and lease-based dispatcher state.
create table outbox_events (
  id uuid primary key check (is_uuid_v7(id)),
  topic text not null check (char_length(topic) between 1 and 120),
  aggregate_id uuid not null check (is_uuid_v7(aggregate_id)),
  sequence bigint not null check (sequence >= 0),
  house_id uuid null check (house_id is null or is_uuid_v7(house_id)),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  sent_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint outbox_events_aggregate_sequence_unique unique (aggregate_id, sequence),
  constraint outbox_events_terminal_state_check check (sent_at is null or failed_at is null)
);

create index outbox_events_dispatch_idx
  on outbox_events (available_at, id)
  where sent_at is null and failed_at is null;
