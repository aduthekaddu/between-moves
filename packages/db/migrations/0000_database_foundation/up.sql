-- [BM-004] Foundation extension and UUIDv7 validation support.
create extension if not exists pgcrypto;

create function is_uuid_v7(value uuid)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select (get_byte(uuid_send(value), 6) >> 4) = 7;
$$;

comment on function is_uuid_v7(uuid) is
  'Validates application-generated UUIDv7 identifiers; generation remains application-owned.';
