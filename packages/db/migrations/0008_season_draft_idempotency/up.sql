-- [BM-019] Retry-safe draft Season creation without retaining caller idempotency keys.
alter table seasons add column draft_idempotency_digest text null;
alter table seasons add column draft_idempotency_payload_digest text null;

alter table seasons add constraint seasons_draft_idempotency_digest_check
  check (
    draft_idempotency_digest is null
    or draft_idempotency_digest ~ '^[0-9a-f]{64}$'
  );

alter table seasons add constraint seasons_draft_idempotency_payload_digest_check
  check (
    draft_idempotency_payload_digest is null
    or draft_idempotency_payload_digest ~ '^[0-9a-f]{64}$'
  );

alter table seasons add constraint seasons_draft_idempotency_pair_check
  check (
    (draft_idempotency_digest is null) = (draft_idempotency_payload_digest is null)
  );

create unique index seasons_house_draft_idempotency_unique
  on seasons (house_id, draft_idempotency_digest)
  where draft_idempotency_digest is not null;
