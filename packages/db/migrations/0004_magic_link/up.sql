-- [BM-008] [DR-ID-02..03] Better Auth-owned account and magic-link verification storage.
create function set_user_email_verified_at()
returns trigger
language plpgsql
as $$
begin
  if new.email_verified and new.email_verified_at is null then
    new.email_verified_at := now();
  end if;
  return new;
end;
$$;

create trigger users_email_verified_at_trigger
before insert or update of email_verified on users
for each row execute function set_user_email_verified_at();

create table accounts (
  id uuid primary key check (is_uuid_v7(id)),
  issuer text not null,
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  access_token text null,
  refresh_token text null,
  id_token text null,
  access_token_expires_at timestamptz null,
  refresh_token_expires_at timestamptz null,
  scope text null,
  password text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_issuer_account_unique unique (issuer, account_id)
);

create index accounts_user_id_idx on accounts (user_id);

create table verification (
  id uuid primary key check (is_uuid_v7(id)),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index verification_identifier_idx on verification (identifier);
create index verification_expiry_idx on verification (expires_at);
