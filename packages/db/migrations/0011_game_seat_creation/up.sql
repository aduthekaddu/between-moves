-- [BM-022] Transport retry identity for atomic Game/Open-seat creation.
alter table open_seats
  add column creation_idempotency_digest text null,
  add column creation_payload_digest text null,
  add constraint open_seats_creation_idempotency_digest_check check (
    creation_idempotency_digest is null
      or creation_idempotency_digest ~ '^[0-9a-f]{64}$'
  ),
  add constraint open_seats_creation_payload_digest_check check (
    creation_payload_digest is null
      or creation_payload_digest ~ '^[0-9a-f]{64}$'
  ),
  add constraint open_seats_creation_idempotency_pair_check check (
    (creation_idempotency_digest is null) = (creation_payload_digest is null)
  );

create unique index open_seats_creator_idempotency_unique
  on open_seats (house_id, creator_membership_id, creation_idempotency_digest)
  where creation_idempotency_digest is not null;
