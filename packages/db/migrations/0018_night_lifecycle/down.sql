-- [BM-035] Development/test reversal; production uses forward fixes.
drop table if exists night_rsvps;
alter table house_nights drop constraint if exists house_nights_lifecycle_times_check;
