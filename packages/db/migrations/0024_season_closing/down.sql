-- [BM-047] Development/test reversal; production uses forward fixes.
drop table if exists season_final_standings;
drop function if exists guard_season_final_standings();
