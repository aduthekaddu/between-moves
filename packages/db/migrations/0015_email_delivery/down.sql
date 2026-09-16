drop table email_delivery_events;
alter table outbox_events drop constraint outbox_events_last_error_length_check;
alter table outbox_events drop column last_error;
