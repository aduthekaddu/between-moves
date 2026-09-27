-- [BM-050] Account deletion is one-way: a deleted identity keeps only a scrubbed tombstone that
-- shared House records (Games, Moves, scores, Closing Books) can still reference.

-- Any identity already marked deleted becomes a tombstone before the shape is enforced.
update users
   set display_name = 'Former member',
       email = id::text || '@deleted.invalid',
       email_verified = false,
       email_verified_at = null,
       image_url = null,
       deleted_at = coalesce(deleted_at, now()),
       updated_at = now()
 where status = 'deleted';

alter table users
  add constraint users_deleted_profile_check check (
    status = 'active'
    or (
      display_name = 'Former member'
      and email = (id::text || '@deleted.invalid')
      and email_verified = false
      and email_verified_at is null
      and image_url is null
      and deleted_at is not null
    )
  );

create function guard_deleted_users()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'deleted' and new.status <> 'deleted' then
    raise exception 'a deleted account cannot be restored' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger users_deletion_irreversible
  before update on users
  for each row execute function guard_deleted_users();

-- Neither a session nor an active membership may attach to a deleted identity. The share lock
-- waits out an in-flight deletion (which holds the user row for update) and then reads its result.
create function guard_deleted_user_reference()
returns trigger
language plpgsql
as $$
declare
  person_status text;
begin
  if tg_table_name = 'memberships' then
    if new.status <> 'active' then
      return new;
    end if;
  end if;
  select status into person_status from users where id = new.user_id for share;
  if person_status = 'deleted' then
    raise exception 'a deleted account cannot hold a % row', tg_table_name using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger sessions_require_active_user
  before insert or update of user_id on sessions
  for each row execute function guard_deleted_user_reference();

create trigger memberships_require_active_user
  before insert or update of user_id, status on memberships
  for each row execute function guard_deleted_user_reference();
