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
| `pnpm db:generate`     | Generate candidate SQL with Drizzle Kit         |
| `pnpm check`           | Run lint, typecheck, and test together          |
| `pnpm format`          | Format the repo with Prettier                   |
| `pnpm format:check`    | Check formatting without writing                |

## Workspace layout

```text
apps/web        Next.js App Router application and composition root
apps/worker     Trigger.dev outbox and leased analysis dispatchers
packages/db     PostgreSQL pool, Drizzle adapter, migrations, and DB health probe
```

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
