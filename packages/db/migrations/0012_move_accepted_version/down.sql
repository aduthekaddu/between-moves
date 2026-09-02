alter table moves drop constraint moves_game_accepted_version_unique;
alter table moves drop constraint moves_accepted_version_check;
alter table moves drop column accepted_version;
