-- [BM-011] Development/test reversal; production uses forward fixes.
drop trigger if exists memberships_preserve_house_owner on memberships;
drop trigger if exists houses_exactly_one_owner on houses;
drop function if exists check_house_owner_constraint();
drop function if exists assert_house_has_matching_owner(uuid);
drop table if exists membership_audit;
alter table if exists houses drop constraint if exists houses_owner_membership_fk;
drop table if exists memberships;
drop table if exists houses;
