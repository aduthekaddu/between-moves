-- [BM-019] Development/test reversal; production uses forward fixes.
drop index if exists seasons_house_draft_idempotency_unique;
alter table seasons drop constraint if exists seasons_draft_idempotency_pair_check;
alter table seasons drop constraint if exists seasons_draft_idempotency_payload_digest_check;
alter table seasons drop constraint if exists seasons_draft_idempotency_digest_check;
alter table seasons drop column if exists draft_idempotency_payload_digest;
alter table seasons drop column if exists draft_idempotency_digest;
