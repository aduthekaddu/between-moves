-- [BM-011] [DR-HOUSE-01..02] [DR-MEM-01..02] House and membership foundation.
create table houses (
  id uuid primary key check (is_uuid_v7(id)),
  name text not null check (char_length(name) between 1 and 80),
  slug citext not null,
  description text null check (description is null or char_length(description) <= 500),
  emblem_seed text not null,
  time_zone text not null,
  owner_membership_id uuid null,
  member_cap integer not null default 30 check (member_cap between 3 and 30),
  status text not null default 'active' check (status in ('active', 'deleted')),
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint houses_deletion_state_check check (
    (status = 'active' and deleted_at is null) or status = 'deleted'
  )
);

create unique index houses_active_slug_unique
  on houses (slug)
  where status <> 'deleted';

create table memberships (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  role text not null default 'member' check (role in ('owner', 'steward', 'member')),
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  display_name_snapshot text null,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_house_user_unique unique (house_id, user_id),
  constraint memberships_departure_state_check check (
    (status = 'active' and left_at is null) or
    (status in ('left', 'removed') and left_at is not null)
  )
);

create unique index memberships_one_active_owner_per_house
  on memberships (house_id)
  where role = 'owner' and status = 'active';
create index memberships_house_status_idx on memberships (house_id, status);
create index memberships_user_status_idx on memberships (user_id, status);

alter table houses
  add constraint houses_owner_membership_fk
  foreign key (owner_membership_id) references memberships(id) on delete restrict
  deferrable initially deferred;

create table membership_audit (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  actor_membership_id uuid null references memberships(id) on delete restrict,
  action text not null check (action in (
    'invite_created', 'invite_revoked', 'member_joined', 'member_removed',
    'member_left', 'role_changed', 'ownership_transferred'
  )),
  target_membership_id uuid null references memberships(id) on delete restrict,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index membership_audit_house_created_idx
  on membership_audit (house_id, created_at);

-- Deferred cross-table validation turns the partial unique "at most one" into exactly one.
create function assert_house_has_matching_owner(target_house_id uuid)
returns void
language plpgsql
as $$
begin
  if exists (
    select 1 from houses h
     where h.id = target_house_id
       and h.status = 'active'
       and not exists (
         select 1 from memberships m
          where m.id = h.owner_membership_id
            and m.house_id = h.id
            and m.role = 'owner'
            and m.status = 'active'
       )
  ) then
    raise exception 'active House must reference its sole active Owner'
      using errcode = '23514';
  end if;
end;
$$;

create function check_house_owner_constraint()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'houses' then
    perform assert_house_has_matching_owner(coalesce(new.id, old.id));
  else
    if tg_op <> 'INSERT' then
      perform assert_house_has_matching_owner(old.house_id);
    end if;
    if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.house_id is distinct from old.house_id) then
      perform assert_house_has_matching_owner(new.house_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger houses_exactly_one_owner
  after insert or update of owner_membership_id, status on houses
  deferrable initially deferred
  for each row execute function check_house_owner_constraint();

create constraint trigger memberships_preserve_house_owner
  after insert or update or delete on memberships
  deferrable initially deferred
  for each row execute function check_house_owner_constraint();
