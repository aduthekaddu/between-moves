# Between Moves

Your chess house. A private chess house for a small group that already knows one another.

This repository is a pnpm + Turborepo monorepo. It contains the Next.js App Router web
application and the shared PostgreSQL/Drizzle database adapter.

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
apps/web        Next.js App Router application and composition root
apps/worker     Trigger.dev outbox and leased analysis dispatchers
packages/db     PostgreSQL pool, Drizzle adapter, migrations, and DB health probe
```

## Database migrations

Reviewed SQL in `packages/db/migrations/NNNN_name/{up,down}.sql` is the source of truth.
`pnpm db:migrate` applies pending directories in name order under an advisory lock, one
transaction per migration; production is forward-only. `pnpm db:generate` only drafts SQL
from `packages/db/src/schema.ts` into the git-ignored `packages/db/migrations/generated/`.
Review the draft, then copy what you keep into the next numbered directory with a matching
`down.sql`.

## Analysis worker

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

## Design system: paper and lamplight

The interface is built from folded paper, indigo card and one lamp. Three dyes carry
meaning: indigo for the House, vermilion for your turn and alarms, marigold for the lamp
(selection, live, the leader). House, Season and Puzzle pages are day paper; the Night rail,
live Games and Invitations are lamp-lit indigo.

- **Type:** Anek by Ek Type (one variable family, weight 100–800 and width 75–125) for Latin
  and nine Indian scripts, with IBM Plex Mono for notation, clocks and labels. Fonts are
  self-hosted from `apps/web/src/fonts` with their OFL licences; the landing page loads
  small per-script subsets that carry only the glyphs it shows.
- **Pieces:** `apps/web/public/models/house-set.glb` is a low-poly, folded-paper rebuild of
  the CC0 Poly Haven chess set by Riley Queen. The in-app board sprites in
  `apps/web/public/pieces` and the landing turntables are rendered from the same models, so
  every surface shows the same set.
- **Motion:** pieces, stamps and reveals move on twos (12 fps) while light and camera stay
  continuous. Entrances animate transforms only, so text never drops below its contrast
  ratio mid-animation, and `prefers-reduced-motion` stills them.
- **Landing hero:** `apps/web/src/app/_landing/hero` is a Three.js scene loaded after first
  paint: a paper-stencil board under a lamp that follows the pointer, with the House present
  only as shadows. In development, `/?t=<seconds>&lamp=<x>,<z>` pins one frame for review.
