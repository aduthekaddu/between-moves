# Deploy Between Moves

The web app on Vercel serves pages and API routes. The outbox, nudge, and analysis jobs live in `apps/worker` and run on Trigger.dev. Do this after the web app has a database and the environment from `apps/web/.env.example`.

Pilot launch is a separate decision. Record it in [pilot-go-no-go.md](pilot-go-no-go.md). Local checks do not sign that sheet.

## Deploy the Trigger.dev jobs

Create a Trigger.dev project and copy the `proj_...` reference from Project Settings. The project URL slug is not that reference.

Set `TRIGGER_PROJECT_ID` to that reference in the shell you use for deployment. Copy the keys in `apps/worker/.env.example` into the matching Trigger.dev environment. For the live Vercel site, use the Production environment with the same Neon database, `BETTER_AUTH_SECRET`, and `REALTIME_SERVER_KEY` as Vercel. Set `APP_ORIGIN` to the deployed web origin. `RESEND_FROM_EMAIL` must use a domain verified in Resend.

Set `ANALYSIS_ENABLED` to the string `false` until an analysis engine is deployed. `runAnalysisWorker` in `apps/worker/src/composition.ts` returns `disabled` only when that variable is exactly `false`. An unset variable does not disable it. When you turn analysis on, set `ANALYSIS_WORKER_URL` and `ANALYSIS_WORKER_SECRET` as well. Sign-in links wait in PostgreSQL until the outbox dispatcher is running against that same database.

From `apps/worker`, log in and deploy with the CLI version that matches the SDK, 4.5.6.

```bash
pnpm dlx trigger.dev@4.5.6 login
pnpm trigger:deploy
```

The config already discovers `src/trigger`. After deployment, the Production dashboard should show these schedules.

- `outbox-dispatcher-schedule` runs each minute.
- `nudge-dispatcher-schedule` runs every fifteen minutes.
- `analysis-worker-schedule` runs each minute. While `ANALYSIS_ENABLED` is `false`, the run returns `disabled` before it leases a job.

`outbox-dispatcher` is also there for event-triggered runs. `pnpm trigger:dev` talks to the Development environment only while that process stays running. A Staging environment needs its own database and secrets.

```bash
pnpm trigger:deploy --env staging
```

## Register the Resend webhook

In Resend, register `https://between-moves-web.vercel.app/api/webhooks/resend` and select the delivery events you want recorded. Record at least `email.sent`, `email.delivered`, `email.bounced`, and `email.failed`. Copy the webhook signing secret, the `whsec_...` value, into `RESEND_WEBHOOK_SECRET` on the Vercel web app. That secret is separate from the Resend API key the worker uses to send mail.

## Analysis engine contract

`dispatchAnalysisJob` in `apps/worker/src/modules/stories/analysis.ts` leases one job and `POST`s JSON to `ANALYSIS_WORKER_URL`. The body has `jobId`, `gameId`, `engineVersion`, `leaseToken`, and `callbackUrl`. The header `x-analysis-signature` is a SHA-256 HMAC of that exact body, hex encoded, using `ANALYSIS_WORKER_SECRET`. `signAnalysisCallback` in `packages/adapters/src/analysis-signature.ts` builds it. The engine answers with HTTP 202.

The engine later `POST`s a signed result to `/api/internal/analysis/callback`. The web handler checks the same header. A completed body has `status` `completed` and `result.swings`. Each swing has integer `ply`, `centipawnsBefore`, and `centipawnsAfter`, and a non-empty `bestLine` of UCI moves from the position before that ply. The stored puzzle position is that earlier position, taken from the game's moves. A failed body has `status` `failed`.

`generatePuzzleCandidates` in `apps/web/src/modules/stories/candidates.ts` keeps a swing when the absolute centipawn change is at least `PUZZLE_SWING_THRESHOLD_CP`, which is 200. The worker passes `3` as `maxAttempts` when it claims, expires, and fails a job. `fail` in `packages/db/src/pg-analysis-job-repository.ts` sets the job to `failed` once `attempts` is at least that number. A failed engine call does not change the completed game.

`ANALYSIS_ENGINE_VERSION` defaults to `v1` in `apps/worker/src/composition.ts` when the variable is unset. `enqueueAnalysisRequest` returns without writing a job when analysis is disabled.
