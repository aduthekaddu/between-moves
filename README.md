# Between Moves

Your chess house. A private chess house for a small group that already knows one another.

This repository is a pnpm + Turborepo monorepo. It contains the Next.js App Router web
application, the Trigger.dev worker, and the shared packages both compose.

## Prerequisites

- **Node.js 24** (`>=24 <25`; see `.node-version`)
- **pnpm 11.24.0** (pinned via `packageManager` in `package.json`)

Enable the pinned pnpm with Corepack:

```bash
corepack enable
```

## Install

```bash
pnpm install
```

## Commands

Run from the repository root:

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `pnpm dev`             | Start the web app in development (`next dev`)   |
| `pnpm build`           | Build all packages (`next build`)               |
| `pnpm lint`            | Lint with ESLint                                |
| `pnpm typecheck`       | Type-check with `tsc --noEmit`                  |
| `pnpm test`            | Run tests with `vitest run`                     |
| `pnpm test:e2e`        | Run Playwright end-to-end tests                 |
| `pnpm db:migrate`      | Apply pending reviewed PostgreSQL migrations    |
| `pnpm db:migrate:down` | Reverse the latest migration outside production |
| `pnpm db:generate`     | Draft candidate SQL with Drizzle Kit            |
| `pnpm check`           | Run lint, typecheck, and test together          |
| `pnpm format`          | Format the repo with Prettier                   |
| `pnpm format:check`    | Check formatting without writing                |

## Workspace layout

```text
apps/web                Next.js App Router application and composition root
apps/worker             Trigger.dev outbox and leased analysis dispatchers
packages/domain         Framework-free rules, value types, and port interfaces
packages/application    Use cases and outbox consumers composed from domain ports
packages/contracts      Zod request and response schemas shared across HTTP seams
packages/db             PostgreSQL pool, repositories, migrations, and DB health probe
packages/adapters       Provider adapters: Upstash, Resend, realtime, chess.js, and codecs
packages/observability  Structured logger and metric stubs; imports no workspace package
```

Dependencies point inward: apps compose packages, `application` imports only `domain` and
`contracts`, and `domain` imports `contracts` as types only. `pnpm lint:boundaries`
enforces these rules and `tooling/import-boundaries.test.mjs` pins the allow-lists.

## Pilot operations

Pilot operators: see [BM-052 pilot runbook](ops/pilot-runbook.md) for dashboard generation,
alert test fires, the isolated staging restore drill, product queries, and the
[go/no-go record](ops/pilot-go-no-go.md). Pilot launch is blocked until staging
evidence and approval are recorded.

## Database migrations

Reviewed SQL in `packages/db/migrations/NNNN_name/{up,down}.sql` is the source of truth.
`pnpm db:migrate` applies pending directories in name order under an advisory lock, one
transaction per migration; production is forward-only. `pnpm db:generate` only drafts SQL
from `packages/db/src/schema.ts` into the git-ignored `packages/db/migrations/generated/`.
Review the draft, then copy what you keep into the next numbered directory with a matching
`down.sql`.

## Analysis worker

### Deploy the Trigger.dev jobs

The web app on Vercel handles pages and API routes. The scheduled outbox, nudge, and
analysis jobs live in `apps/worker` and run on Trigger.dev. Create a Trigger.dev project,
then find its `proj_...` project reference in Project Settings. The project URL slug is
not this reference.

Set `TRIGGER_PROJECT_ID` to that reference in the shell used for deployment. Add the
runtime values in `apps/worker/.env.example` to the matching Trigger.dev environment.
For the live Vercel site, use the **Production** environment with the same Neon database,
`BETTER_AUTH_SECRET`, and `REALTIME_SERVER_KEY` as Vercel. Set `APP_ORIGIN` to the deployed
web origin. The `RESEND_FROM_EMAIL` address must use a domain verified in Resend. Keep
`ANALYSIS_ENABLED=false` until an analysis engine is deployed; otherwise set
`ANALYSIS_WORKER_URL` and `ANALYSIS_WORKER_SECRET` as well. Sign-in links are queued in
PostgreSQL and will not be emailed until the outbox dispatcher is running against that
same database.

From `apps/worker`, authenticate and deploy with the CLI version matching the SDK:

```bash
pnpm dlx trigger.dev@4.5.6 login
pnpm trigger:deploy
```

The config already discovers `src/trigger`. After deployment, check the Trigger.dev
**Production** dashboard for `outbox-dispatcher-schedule` (each minute),
`nudge-dispatcher-schedule` (every fifteen minutes), and `analysis-worker-schedule`
(each minute; inactive with the environment flag). The outbox also exposes
`outbox-dispatcher` for event-triggered runs. `pnpm trigger:dev` connects the Development
environment only while that CLI process stays running. Deploy separately with
`pnpm trigger:deploy --env staging` if you use a Staging environment; give it its own
database and secrets.

### Resend delivery webhook

In Resend, register `https://between-moves-web.vercel.app/api/webhooks/resend` as the
webhook endpoint and select the email delivery events you want recorded (at least
`email.sent`, `email.delivered`, `email.bounced`, and `email.failed`). Copy the webhook's
`whsec_...` signing secret into the web app's `RESEND_WEBHOOK_SECRET` on Vercel. This is
separate from the Resend API key used by the Trigger.dev worker to send mail.

### Analysis engine

The outbox dispatcher turns each `game.analysis-requested` event into one durable
`analysis_jobs` row. The separate `analysis-worker-schedule` leases jobs and sends
`POST` requests to `ANALYSIS_WORKER_URL`. The request contains a job ID, game ID,
engine version, lease token, and callback URL; its `x-analysis-signature` is a
SHA-256 HMAC of the exact JSON body using `ANALYSIS_WORKER_SECRET`. The engine
responds with HTTP 202 and later posts a similarly signed result to
`/api/internal/analysis/callback`. A completed result has `status: "completed"`
and `result.swings` with numeric `ply`, `centipawnsBefore`, and
`centipawnsAfter` values, plus a nonempty `bestLine` of UCI moves from the
position before that ply. Swings of at least 200 centipawns create one private
`puzzle_candidates` row per Game ply, using the canonical position from Moves.
Candidates start pending review in the Game's House and Season. A failure has
`status: "failed"`.

Set `ANALYSIS_ENABLED=false` in the worker to disable enqueueing and dispatch.
`ANALYSIS_ENGINE_VERSION` defaults to `v1`. Jobs retry at most three times;
engine failures do not alter the completed game. Completion callback logs include
`analysis_job_duration_ms`; worker and callback logs include
`analysis_job_failure_total`; successful candidate creation increments
`puzzle_candidate_created_total` in callback logs.

Active House members can review pending candidate positions at `/h/{houseId}/puzzles`.
Confirming the position and adding a prompt publishes a House-only Puzzle through
`POST /api/houses/{houseId}/puzzles`. The publication and `puzzle.published` scoring
outbox event commit together. The confirming member is the contributor; the Season
scoring consumer awards one point for each of their first two published puzzles in
that Season. Publication logs expose `puzzle_published_total`.

An Owner or Steward closes the active Season from `/h/{houseId}/season` through
`POST /api/houses/{houseId}/seasons/{seasonId}/close`. The first transaction moves the
Season to `closing`, writes an immutable `season_final_standings` snapshot from the points
ledger (every active Member plus anyone who scored, with shared competition ranks), and
enqueues one `season.closing` outbox event for Closing Book generation. A second
transaction marks the Season `closed`. Retrying resumes a Season left in `closing`; a
closed Season replays without a second event. Once closing starts, the standings API
returns the frozen snapshot with `finalized: true`. Each House still has at most one
`active` or `closing` Season, so a new Season can be drafted only after the close
completes. The command logs `season.closed`.

The outbox worker turns each `season.closing` event into one `closing_books` row for that
Season. Generation reads the frozen standings plus the completed Games, analysed swings,
House Puzzles and Night attendance recorded up to the closing instant. It composes
participation, the largest swing from each Game (top three), and Season awards. Each award
names the count that earned it, ties share it, and nothing is carried onto a Member. The
book is stored privately as `generated`, then published; a retry resumes an unpublished
book and a replay is a duplicate. Once published, the payload and its `generation_version`
are immutable. After each dispatch the worker also replays, ten at a time, any
`season.closing` event that was acknowledged while its Season still has no published book,
such as events consumed by a worker deployed before Closing Books. Active Members read the
latest Season's book at `/h/{houseId}/closing-book` (`noindex`), which is linked from the
final standings; anyone else gets the House not-found page. Worker logs expose
`closing_book.generation` and `closing_books_repaired`; each view of a published book logs
`bm.closing_book.viewed` with the reader's `actor_membership_id` and `actor_role`, so a
non-owner's return to the book can be counted.

Renewal reuses the Charter flow. After a close, an Owner or Steward publishes the next Charter
from `/h/{houseId}/season`, which the end of the Closing Book also links to. The new Season
starts from an empty ledger: standings, awards and the Charter itself carry nothing over, and
late results from the closed Season still score only that Season. Once the next Season is
active, the Season page drops the final standings but keeps a link to the last Closing Book.

## Account export and deletion

A signed-in person manages their own data at `/account` (`noindex`), linked from every House
masthead. `GET /api/account/export` downloads one JSON file keyed only by the session's identity:
the profile, every membership, the chat messages, Game notes, reactions and House Puzzles they
wrote, the Games they sat in (their colour and result), the Moves they played, and their Season
ledger points and final standings. It never includes another Member's content, name or address.

`POST /api/account/delete` requires the expected Origin and the body
`{"confirmation":"delete my account"}`. One transaction ends every active membership as `left`
(with a `member_left` audit row whose metadata reads `account_deleted`), records `Former member`
as each membership's display name, deletes the person's sessions, provider accounts and pending
sign-in links, renames them in queued chat events, and scrubs the user row to a tombstone:
`Former member`, `<user id>@deleted.invalid`, no image, `status = 'deleted'`. The response expires
the browser's sign-in cookies. An Owner of an active House gets 409 and must transfer ownership
first. Games, Moves, scores, final standings, messages, notes and Closing Books stay; every read
names the person `Former member`, and a published Closing Book's stored payload is renamed as it
is read rather than rewritten. Migration `0026_account_deletion` makes deletion one-way: a deleted
user can never be reactivated, hold a session, or rejoin a House, and a later sign-in with the same
address creates a new identity. The handlers log `identity.account.exported` and
`identity.account.deleted` with counts only.

## Design system: Lamplight

Between Moves is staged as a silhouette theatre: one lamp behind one cloth screen, and a
company of cut-paper puppets in between, after Lotte Reiniger's silhouette films and the
shadow theatres before them. Day pages are the lit cloth (warm, grained, brightest under the
lamp); the Night rail, live Games, the Closing Book, Invitations and the auth pages are the
dark stage around lit panels. Colour is rare and means something: amber for the lamp (live,
selected, the leader), vermilion for your turn and alarms, indigo for the House, leaf for done.
Motifs: dotted perforation rules, notched ticket stubs, rivet pips and a black scalloped valance
across the top of every page.

- **Type:** Anek by Ek Type (variable, weight 100–800, width 75–125) for the interface, set in
  condensed capitals for titles; IBM Plex Mono for notation, clocks and labels. The landing's
  word journey adds two tiny subsets (Anek Devanagari for चतुरङ्ग, Noto Nastaliq Urdu for شطرنج).
  Fonts are self-hosted from `apps/web/src/fonts` with their OFL licences.
- **Company:** the chess pieces are the cast (King, Queen, Rook, Bishop, Knight and a chorus of
  Pawns), with the House's friends, a lamplighter and the scenery in the same black card. Sprites
  live in `apps/web/public/theatre` (large and `-s` small WebP) and are listed with their sizes in
  `apps/web/src/app/_theatre/assets.ts`. Board pieces in `apps/web/public/pieces` are cut from the
  same set: ivory paper with a black keyline, and black card.
- **Motion:** puppets move on twos (12 fps) with a puppeteer's small hand-held jitter; light stays
  continuous. Titles rise into place on rods, a word at a time (the landing's title letter by
  letter). Buttons press down on twos. `prefers-reduced-motion` stills all of it.
- **Landing theatre:** `apps/web/src/app/_theatre/engine.ts` is a small WebGL2 renderer. A
  puppet at distance z from the screen casts a shadow magnified by 1 / (1 − z) about the lamp and
  softened by the lamp's size; sprites multiply the screen's light, so black card blocks it and
  coloured tissue windows glow. The lamp follows the pointer. `apps/web/src/app/_landing/stage`
  cues each act's puppets from how far the reader has scrolled into it. Without WebGL2, or with
  reduced motion, static posters stand in. In development, `/?t=<seconds>&lamp=<x>,<y>` pins one
  frame for review.
