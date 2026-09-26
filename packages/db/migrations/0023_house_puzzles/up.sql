-- [BM-046] A reviewed candidate becomes one House-visible Puzzle.
alter table puzzle_candidates add constraint puzzle_candidates_id_house_unique unique (id, house_id);

create table house_puzzles (
  id uuid primary key,
  candidate_id uuid not null unique,
  house_id uuid not null,
  season_id uuid not null,
  game_id uuid not null,
  position_fen text not null check (char_length(position_fen) between 1 and 200),
  prompt text not null check (char_length(prompt) between 1 and 280),
  contributor_membership_id uuid not null,
  confirmed_by_membership_id uuid not null,
  published_at timestamptz not null,
  constraint house_puzzles_house_id_unique unique (id, house_id),
  constraint house_puzzles_candidate_house_fk foreign key (candidate_id, house_id)
    references puzzle_candidates(id, house_id) on delete restrict,
  constraint house_puzzles_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete restrict,
  constraint house_puzzles_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint house_puzzles_contributor_house_fk foreign key (contributor_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint house_puzzles_reviewer_house_fk foreign key (confirmed_by_membership_id, house_id)
    references memberships(id, house_id) on delete restrict
);

create index house_puzzles_house_published_idx
  on house_puzzles (house_id, published_at desc);
