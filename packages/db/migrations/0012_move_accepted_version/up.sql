-- [BM-024] [DR-MOVE-04] Keep the first canonical Move response independent of outbox retention.
alter table moves add column accepted_version integer;

-- BM-021 rows predate submitMove; at that point version advanced only with ply.
update moves set accepted_version = ply;

alter table moves alter column accepted_version set not null;
alter table moves add constraint moves_accepted_version_check check (accepted_version > 0);
alter table moves add constraint moves_game_accepted_version_unique unique (game_id, accepted_version);
