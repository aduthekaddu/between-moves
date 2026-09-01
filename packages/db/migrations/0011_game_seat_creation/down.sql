drop index open_seats_creator_idempotency_unique;

alter table open_seats
  drop constraint open_seats_creation_idempotency_pair_check,
  drop constraint open_seats_creation_payload_digest_check,
  drop constraint open_seats_creation_idempotency_digest_check,
  drop column creation_payload_digest,
  drop column creation_idempotency_digest;
