-- [BM-005] Scaffold-only seeded House reference used to prove authorized repository reads.
create table house_reference_records (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null check (is_uuid_v7(house_id)),
  authorized_viewer_id uuid not null check (is_uuid_v7(authorized_viewer_id)),
  membership_status text not null check (membership_status in ('active', 'left', 'removed')),
  label text not null check (char_length(label) between 1 and 120)
);

create index house_reference_records_authorized_read_idx
  on house_reference_records (house_id, authorized_viewer_id)
  where membership_status = 'active';

insert into house_reference_records (
  id,
  house_id,
  authorized_viewer_id,
  membership_status,
  label
) values
  (
    '01941f29-7c00-7000-8000-000000000003',
    '01941f29-7c00-7000-8000-000000000001',
    '01941f29-7c00-7000-8000-000000000002',
    'active',
    'Maple House reference'
  ),
  (
    '01941f29-7c00-7000-8000-000000000013',
    '01941f29-7c00-7000-8000-000000000011',
    '01941f29-7c00-7000-8000-000000000012',
    'active',
    'Cedar House reference'
  );
