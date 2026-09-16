-- [BM-030] [DR-DELIV-01/03] Retained delivery errors and idempotent Resend events.
alter table outbox_events add column last_error text null;
alter table outbox_events add constraint outbox_events_last_error_length_check
  check (last_error is null or char_length(last_error) between 1 and 2000);

create table email_delivery_events (
  id text primary key check (char_length(id) between 1 and 256),
  event_type text not null check (event_type in (
    'email.bounced', 'email.clicked', 'email.complained', 'email.delivered',
    'email.delivery_delayed', 'email.failed', 'email.opened', 'email.scheduled',
    'email.sent', 'email.suppressed'
  )),
  email_id text not null check (char_length(email_id) between 1 and 256),
  occurred_at timestamptz not null,
  received_at timestamptz not null
);

create index email_delivery_events_email_occurred_idx
  on email_delivery_events (email_id, occurred_at);
