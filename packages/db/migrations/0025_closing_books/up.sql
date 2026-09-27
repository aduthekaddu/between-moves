-- [BM-048] One Closing Book per Season: generated privately, then published to the House.
create table closing_books (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null,
  season_id uuid not null,
  source_event_id uuid not null,
  generation_version integer not null check (generation_version > 0),
  state text not null default 'generated' check (state in ('generated', 'published')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null,
  published_at timestamptz null,
  constraint closing_books_season_unique unique (season_id),
  constraint closing_books_source_event_unique unique (source_event_id),
  constraint closing_books_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete cascade,
  constraint closing_books_publication_shape_check check (
    (state = 'generated' and published_at is null)
    or (state = 'published' and published_at is not null and published_at >= generated_at)
  )
);

-- Publication is the only permitted update. Once published the book is the House's record:
-- its payload, version, and publication time never change. Removal follows the Season.
create function guard_closing_books()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'published' then
    raise exception 'closing_books is immutable once published' using errcode = '55000';
  end if;
  if new.id <> old.id
     or new.house_id <> old.house_id
     or new.season_id <> old.season_id
     or new.source_event_id <> old.source_event_id
     or new.generation_version <> old.generation_version
     or new.payload <> old.payload
     or new.generated_at <> old.generated_at then
    raise exception 'closing_books may only change by publication' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger closing_books_publication_only
  before update on closing_books
  for each row execute function guard_closing_books();
