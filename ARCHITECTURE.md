# Architecture

Between Moves is a pnpm workspace. `apps/web` serves the house in the browser. `apps/worker` runs the scheduled jobs. The packages under `packages/` hold the rules, the use cases, the database, and the outside services.

## How the packages depend on each other

An arrow means the package depends on the one it points at. The edges are the `@between-moves/*` entries in each `package.json`.

```mermaid
flowchart TD
  web["apps/web"]
  worker["apps/worker"]
  application["packages/application"]
  adapters["packages/adapters"]
  db["packages/db"]
  domain["packages/domain"]
  contracts["packages/contracts"]
  observability["packages/observability"]

  web --> application
  web --> adapters
  web --> db
  web --> domain
  web --> contracts
  web --> observability
  worker --> application
  worker --> adapters
  worker --> db
  worker --> domain
  worker --> observability
  application --> domain
  adapters --> domain
  adapters --> observability
  db --> domain
```

`packages/contracts` and `packages/domain` and `packages/observability` depend on no workspace package. `apps/web` is the only workspace package that declares a dependency on `contracts`.

`eslint.config.mjs` allows a wider set of imports than those edges. It lets `domain` import `contracts` as a type, and it names `@between-moves/config`, which is not a package. Web configuration is the module `apps/web/src/config/index.ts`.

The root boundary lint covers `apps/worker` and `packages/domain`, `packages/application`, `packages/db`, `packages/adapters`, and `packages/observability`. It does not cover `apps/web` or `packages/contracts`. Web lint is `apps/web/eslint.config.mjs`, which adds the Next.js rules and `react/no-danger`. Contracts has no ESLint config in this repo.

## Where it runs

A member uses the Next.js app on Vercel. That app and the Trigger.dev worker share one Neon database. The worker sends mail through Resend, and Resend posts delivery events back to the web app.

![Between Moves runtime](architecture/stack.png)

The dark picture is [architecture/stack-dark.png](architecture/stack-dark.png). The page behind both pictures is [architecture/stack.html](architecture/stack.html).

## Where a command runs

A page or route under `apps/web/src/app` calls a module in `apps/web/src/modules` or a handler in `apps/web/src/server`. That code is the composition root. It calls a use case from `packages/application`, a repository from `packages/db`, and an adapter from `packages/adapters`. Application code calls domain functions and does not import `db` or `adapters`.

The worker composition root is `apps/worker/src/composition.ts`. Trigger.dev schedules live in `apps/worker/src/trigger`. They dispatch the outbox, nudges, and analysis jobs.

Chess rules go through `packages/adapters/src/chess-js-rules-adapter.ts`. The domain talks to that adapter through the port in `packages/domain/src/games/rules-adapter.ts`.

## Season

One season moves through the states below. `SeasonState` in `packages/domain/src/seasons/index.ts` is `draft`, `active`, `closing`, or `closed`. `transitionSeasonState` allows only the four steps in the chart. A house has at most one `active` or `closing` season. The unique index `seasons_one_active_or_closing_per_house` is in `packages/db/migrations/0007_seasons/up.sql`, and `packages/db/src/pg-season-repository.ts` maps that constraint error.

`beginClosing` freezes standings and enqueues `season.closing` in one transaction. `finalize` marks the season `closed` in a later transaction. Closing book generation does not have to finish before that second transaction. The comment on `TRANSITIONS` in `packages/domain/src/seasons/index.ts` says so.

The chart hides the step that leaves a closed season closed. A following season is a new row, so `transitionSeasonState` has no arrow back to draft. The table stores only `draft`, `active`, `closing`, and `closed`. No season yet means the house has no season row. `transitionSeasonState` throws when the current state is `closed`. A direct SQL update can still move a closed row to `active` if it also clears `closed_at` and the house has no other active or closing season. The check constraint allows that pair of values.

```mermaid
---
title: "Season"
---
stateDiagram-v2
  s0: No season yet
  s1: Draft
  s2: Active
  s3: Closing
  s4: Closed
  [*] --> s0
  s0 --> s1: an owner or steward drafts a season
  s1 --> s2: an owner or steward publishes the charter
  s2 --> s3: an owner or steward starts the close
  s3 --> s4: the close finishes
```

## Night

`NightState` in `packages/domain/src/nights/night.ts` is `scheduled`, `live`, `ended`, or `cancelled`. Start and end go through `transitionNightLifecycle` in `packages/domain/src/nights/lifecycle.ts`. Cancel and reschedule go through `PgNightRepository.change` in `packages/db/src/pg-night-repository.ts`.

An owner, a steward, or the assigned host can press Start Night and End Night. `canHost` in `apps/web/src/app/h/[houseId]/season/night-schedule.tsx` is that rule, and `lockAuthorizedNight` in `packages/db/src/pg-night-lifecycle-repository.ts` matches it. Cancel Night is only for an owner or a steward, and only while the night is scheduled. The lifecycle queries also require the night's season to be `active` or `closing`.

Pressing Start Night on a live night, End Night on an ended night, or confirming cancellation on a cancelled night leaves the state as it is. The chart hides those repeats. Reschedule also stays on Scheduled, so the chart hides it.

```mermaid
---
title: "Night"
---
stateDiagram-v2
  s0: Scheduled
  s1: Cancelled
  s2: Live
  s3: Ended
  [*] --> s0
  s0 --> s1: you confirm cancellation
  s0 --> s2: you press Start Night
  s2 --> s3: you press End Night
```

## Game

The `games.state` check in `packages/db/migrations/0010_games_schema/up.sql` allows `waiting`, `active`, `completed`, and `cancelled`.

Accepting a correspondence seat before it expires sets the game to `active`. Accepting a live seat does the same only while that night is still `live`. Calling the seat off sets a `waiting` game to `cancelled`. Resign, an agreed draw, a flag on the clock, or a move the rules treat as over sets an `active` game to `completed`. Those writes are in `packages/db/src/pg-game-seat-acceptance-repository.ts`, `packages/db/src/pg-game-seat-cancellation-repository.ts`, `packages/db/src/pg-game-completion-repository.ts`, and `packages/db/src/pg-submit-move-repository.ts`. A new command on the wrong state is refused. Repeating a cancel on an already cancelled game leaves it cancelled. Repeating a completion or a move returns the earlier result.

The chart hides those repeats. A late accept does not follow either arrow out of Waiting for a seat. It expires the open seat and leaves the game `waiting`.

```mermaid
---
title: "Game"
---
stateDiagram-v2
  s0: Waiting for a seat
  s1: In play
  s2: Cancelled
  s3: Finished
  [*] --> s0
  s0 --> s1: the other player takes the seat
  s0 --> s2: the seat is called off
  s1 --> s3: the game ends
```

## Game board

The board's client state lives in one reducer, `transition` in `apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts`. `board-store.ts` holds that state outside React and runs what the reducer asks for: a read of the Game, a Move submission, the five-second Undo timer, and a sound. `move-entry.tsx` renders the state and turns page events into reducer events. Its lint rules forbid `useState`, `useRef` and `useReducer`.

The state keeps one full Game snapshot. The board's pieces, check mark, last Move, label and turn dot all come from one position: the reviewed one, else a staged or sending Move on the newest board, else the newest board. One read of the Game is current at a time. Each answer carries the id of its request, and the reducer alone decides whether it applies: an answer to an earlier read still counts when it is newer than the snapshot. A version is not a ply: a draw offer or a resignation moves the version without a Move.

`architecture/models/board/BoardState.tla` models the reducer with the server and an unordered network. "The board model" in [CONTRIBUTING.md](CONTRIBUTING.md) says how it is checked against the reducer.

The chart shows correspondence play with no network failure. It does not draw steps that stay in one state, such as a background poll.

```mermaid
---
title: "Game board, correspondence"
---
stateDiagram-v2
  state "Move not played" as s0 {
    s1: Board up to date
    s2: Board waits for a read
  }
  state "Move staged, Undo shows" as s3 {
    s4: Board up to date
    s5: Board waits for a read
    [*] --> s4
  }
  state "Move sending" as s6 {
    s7: Board up to date
    s8: Board waits for a read
  }
  [*] --> s1
  s1 --> s2: you press Refresh board, or a draw or resign settles
  s1 --> s3: you play a Move
  s4 --> s1: you press Undo
  s4 --> s5: you press Refresh board, or a draw or resign settles
  s4 --> s7: you leave the page or five seconds pass
  s2 --> s1: a read of the Game lands
  s5 --> s2: you press Undo
  s5 --> s8: you leave the page or five seconds pass
  s7 --> s8: you press Refresh board, or a draw or resign settles
  s5 --> s4: a read of the Game lands
  s7 --> s1: the server answers the Move
  s8 --> s7: a read of the Game lands
  s6 --> s2: the server answers the Move
```

## Open seat

The `open_seats.state` check in the same migration allows `open`, `accepted`, `expired`, and `cancelled`. The seat chart is separate from the game chart because those names are not the game names.

The person who opened the seat, or the member a direct challenge names, can call it off while the seat is still `open`. Anyone else is denied. The creator cannot accept their own seat. A late accept sets the seat to `expired`, commits that update, and then reports the seat as not found. The game row stays `waiting`. A later cancel throws not found, because `packages/db/src/pg-game-seat-cancellation-repository.ts` refuses an expired seat. The house list in `packages/db/src/pg-open-seat-read-repository.ts` loads only seats that are still `open` and unexpired.

The chart hides the step that leaves a taken, expired, or called-off seat where it is.

```mermaid
---
title: "Open seat"
---
stateDiagram-v2
  s0: Open
  s1: Taken
  s2: Called off
  s3: Expired
  [*] --> s0
  s0 --> s1: a member accepts in time
  s0 --> s2: the seat is called off
  s0 --> s3: a member accepts after it expires
```

## Account

A signed-in person uses `/account`. Export is `GET /api/account/export`. Delete is `POST /api/account/delete` with the confirmation text `ACCOUNT_DELETION_CONFIRMATION` in `packages/contracts/src/account-data-rights.ts`, which is `delete my account`.

An owner of an active house gets HTTP 409 until they transfer the house. The integration test is `apps/web/src/server/account-data-rights.integration.test.ts`. The deleted person is shown as Former member. Games, moves, and messages stay.

## What to read in the code

Season scoring and the closing book live under `packages/domain/src/seasons` and `packages/application/src/seasons`. Nights live under `packages/domain/src/nights`. The analysis callback contract is in [ops/deploy.md](ops/deploy.md).
