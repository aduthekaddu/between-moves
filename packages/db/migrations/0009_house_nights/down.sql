-- [BM-020] Development/test reversal; production uses forward fixes.
drop table if exists night_audit;
drop table if exists house_nights;

alter table memberships drop constraint if exists memberships_id_house_unique;
alter table seasons drop constraint if exists seasons_id_house_unique;
