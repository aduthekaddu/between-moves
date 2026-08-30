-- [BM-014] [DR-INVITE-01..06] Digest-only House Invitations.
create table invitations (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  token_digest bytea not null,
  intended_email citext null,
  role_grant text not null default 'member' check (role_grant = 'member'),
  expires_at timestamptz not null,
  use_limit integer not null check (use_limit > 0),
  use_count integer not null default 0,
  revoked_at timestamptz null,
  creator_membership_id uuid not null references memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint invitations_token_digest_length_check check (octet_length(token_digest) = 32),
  constraint invitations_use_count_check check (use_count >= 0 and use_count <= use_limit),
  constraint invitations_expiry_check check (expires_at > created_at),
  constraint invitations_restriction_check check (
    (intended_email is null and use_limit >= 1) or
    (intended_email is not null and use_limit = 1)
  )
);

create unique index invitations_token_digest_unique on invitations (token_digest);
create index invitations_house_expiry_idx on invitations (house_id, expires_at);
