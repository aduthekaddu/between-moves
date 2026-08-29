-- [BM-007] [DR-ID-01..04] Better Auth-compatible identity and DB-backed sessions.
create extension if not exists citext;

create table users (
  id uuid primary key check (is_uuid_v7(id)),
  display_name text not null check (char_length(display_name) between 1 and 60),
  email citext not null,
  email_verified boolean not null default false,
  email_verified_at timestamptz null,
  image_url text null,
  status text not null default 'active' check (status in ('active', 'deleted')),
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_deletion_state_check check (
    (status = 'active' and deleted_at is null) or status = 'deleted'
  )
);

create unique index users_active_email_unique
  on users (email)
  where status <> 'deleted';

create table sessions (
  id uuid primary key check (is_uuid_v7(id)),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  expires_at timestamptz not null,
  ip_address text null,
  user_agent text null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_active_expiry_idx
  on sessions (expires_at)
  where revoked_at is null;
