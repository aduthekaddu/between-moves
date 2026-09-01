-- [BM-021] [DR-GAME-01..04] Durable Game snapshot and mode-specific clock policies.
create table games (
  id uuid primary key check (is_uuid_v7(id)),
  house_id uuid not null references houses(id) on delete restrict,
  season_id uuid not null,
  night_id uuid null,
  mode text not null check (mode in ('correspondence', 'live')),
  state text not null default 'waiting'
    check (state in ('waiting', 'active', 'completed', 'cancelled')),
  white_membership_id uuid null,
  black_membership_id uuid null,
  initial_fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  current_fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  current_ply integer not null default 0,
  side_to_move text not null default 'white' check (side_to_move in ('white', 'black')),
  result text null check (result in ('white_win', 'black_win', 'draw', 'aborted')),
  result_reason text null check (
    result_reason in (
      'checkmate', 'stalemate', 'insufficient_material', 'repetition', 'fifty_move',
      'flag', 'resign', 'agreement', 'timeout', 'abort'
    )
  ),
  version integer not null default 0,
  clock_policy jsonb not null,
  white_clock_ms integer null,
  black_clock_ms integer null,
  turn_started_at timestamptz null,
  move_due_at timestamptz null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint games_id_house_unique unique (id, house_id),
  constraint games_season_house_fk foreign key (season_id, house_id)
    references seasons(id, house_id) on delete restrict,
  constraint games_night_house_fk foreign key (night_id, house_id)
    references house_nights(id, house_id) on delete restrict,
  constraint games_white_membership_house_fk foreign key (white_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint games_black_membership_house_fk foreign key (black_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint games_distinct_memberships_check check (
    white_membership_id is null or black_membership_id is null
      or white_membership_id <> black_membership_id
  ),
  constraint games_active_seats_check check (
    state <> 'active' or (white_membership_id is not null and black_membership_id is not null)
  ),
  constraint games_position_counters_check check (current_ply >= 0 and version >= 0),
  constraint games_night_mode_check check (night_id is null or mode = 'live'),
  constraint games_clock_policy_shape_check check ((
    case
      when mode = 'correspondence' then
        jsonb_typeof(clock_policy) = 'object'
        and clock_policy->>'kind' = 'correspondence'
        and (clock_policy - 'kind' - 'perMoveHours') = '{}'::jsonb
        and case when jsonb_typeof(clock_policy->'perMoveHours') = 'number'
          then (clock_policy->>'perMoveHours')::numeric > 0
            and mod((clock_policy->>'perMoveHours')::numeric, 1) = 0
          else false end
      when mode = 'live' then
        jsonb_typeof(clock_policy) = 'object'
        and clock_policy->>'kind' = 'live'
        and (clock_policy - 'kind' - 'initialMs' - 'incrementMs') = '{}'::jsonb
        and case when jsonb_typeof(clock_policy->'initialMs') = 'number'
          then (clock_policy->>'initialMs')::numeric >= 180000
            and mod((clock_policy->>'initialMs')::numeric, 1) = 0
          else false end
        and case when jsonb_typeof(clock_policy->'incrementMs') = 'number'
          then (clock_policy->>'incrementMs')::numeric >= 0
            and mod((clock_policy->>'incrementMs')::numeric, 1) = 0
          else false end
      else false
    end
  ) is true),
  constraint games_clock_columns_check check (
    (mode = 'correspondence' and white_clock_ms is null and black_clock_ms is null
      and turn_started_at is null)
    or
    (mode = 'live' and white_clock_ms is not null and white_clock_ms >= 0
      and black_clock_ms is not null and black_clock_ms >= 0 and move_due_at is null)
  )
);

create index games_house_season_state_idx on games (house_id, season_id, state);
create index games_night_state_idx on games (night_id, state) where night_id is not null;
create index games_white_move_shelf_idx on games (white_membership_id, state, move_due_at)
  where state = 'active' and mode = 'correspondence';
create index games_black_move_shelf_idx on games (black_membership_id, state, move_due_at)
  where state = 'active' and mode = 'correspondence';

-- [BM-021] [DR-SEAT-01..03] House-scoped Open seats with structural race protection.
create table open_seats (
  id uuid primary key check (is_uuid_v7(id)),
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  offered_color text not null check (offered_color in ('white', 'black', 'any')),
  creator_membership_id uuid not null,
  intended_membership_id uuid null,
  state text not null default 'open'
    check (state in ('open', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint open_seats_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete cascade,
  constraint open_seats_creator_house_fk foreign key (creator_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint open_seats_intended_house_fk foreign key (intended_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint open_seats_expiry_check check (expires_at > created_at)
);

create unique index open_seats_one_open_per_game on open_seats (game_id) where state = 'open';
create index open_seats_house_state_expiry_idx on open_seats (house_id, state, expires_at);

-- [BM-021] [DR-MOVE-03] Immutable canonical Move ledger and idempotency keys.
create table moves (
  id uuid primary key check (is_uuid_v7(id)),
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  ply integer not null check (ply > 0),
  actor_membership_id uuid not null,
  uci text not null check (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  san text not null check (char_length(san) between 1 and 32),
  fen_after text not null,
  client_command_id uuid not null,
  server_received_at timestamptz not null default now(),
  clock_snapshot jsonb null,
  constraint moves_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete restrict,
  constraint moves_actor_house_fk foreign key (actor_membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint moves_client_command_uuid_v7_check check (is_uuid_v7(client_command_id)),
  constraint moves_game_ply_unique unique (game_id, ply),
  constraint moves_game_command_unique unique (game_id, client_command_id)
);

-- [BM-021] [DR-REACT-01] One current Reaction per Member and completed Game.
create table game_reactions (
  id uuid primary key check (is_uuid_v7(id)),
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  membership_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  constraint game_reactions_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete cascade,
  constraint game_reactions_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint game_reactions_value_check
    check (reaction in ('well_played', 'brilliant', 'dramatic', 'funny')),
  constraint game_reactions_game_membership_unique unique (game_id, membership_id)
);

-- [BM-021] [DR-NOTE-01] One bounded, plain-text Game note per Member.
create table game_notes (
  id uuid primary key check (is_uuid_v7(id)),
  game_id uuid not null,
  house_id uuid not null references houses(id) on delete restrict,
  membership_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz null,
  constraint game_notes_game_house_fk foreign key (game_id, house_id)
    references games(id, house_id) on delete cascade,
  constraint game_notes_membership_house_fk foreign key (membership_id, house_id)
    references memberships(id, house_id) on delete restrict,
  constraint game_notes_game_membership_unique unique (game_id, membership_id)
);
