-- [BM-034] Development/test reversal; production uses forward fixes.
drop table if exists season_score_ledger;
drop function if exists reject_season_score_ledger_mutation();
alter table games drop constraint if exists games_season_completion_sequence_unique;
alter table games drop constraint if exists games_season_completion_sequence_check;
alter table games drop column if exists season_completion_sequence;
alter table seasons drop constraint if exists seasons_game_completion_sequence_check;
alter table seasons drop column if exists game_completion_sequence;
alter table seasons drop constraint if exists seasons_outbox_sequence_check;
alter table seasons drop column if exists outbox_sequence;
