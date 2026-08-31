-- [BM-018] Development/test reversal; production uses forward fixes.
alter table if exists seasons drop constraint if exists seasons_published_charter_fk;
drop table if exists season_charters;
drop table if exists seasons;
