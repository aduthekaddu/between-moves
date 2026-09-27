-- [BM-050] Development/test reversal; production uses forward fixes.
drop trigger if exists memberships_require_active_user on memberships;
drop trigger if exists sessions_require_active_user on sessions;
drop function if exists guard_deleted_user_reference();
drop trigger if exists users_deletion_irreversible on users;
drop function if exists guard_deleted_users();
alter table users drop constraint if exists users_deleted_profile_check;
