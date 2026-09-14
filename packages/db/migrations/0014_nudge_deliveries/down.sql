drop table nudge_deliveries;
alter table games drop constraint games_outbox_sequence_check;
alter table games drop column outbox_sequence;
