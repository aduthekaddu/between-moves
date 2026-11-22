# Contributing

Set the machine up with the install steps in [README.md](README.md). The scripts below are the ones in the root `package.json` unless the step names another package.

## Check a change

1. Format the files you touched.

   ```bash
   pnpm format
   ```

2. Start the disposable TLS PostgreSQL once per session. It needs Docker and `openssl`.

   ```bash
   pnpm db:test:up
   ```

3. Run lint, typecheck, the unit tests, and the PostgreSQL integration tests.

   ```bash
   pnpm check
   ```

4. When the change touches a BM-051 security criterion, regenerate the matrix and check it.

   ```bash
   pnpm traceability:generate
   pnpm traceability:check
   ```

   `tooling/traceability-matrix.md` is generated. Leave it as the command wrote it.

5. When the change touches a page, run the browser tests.

   ```bash
   pnpm test:e2e
   ```

`pnpm check` does not run `pnpm build`, the traceability check, or the browser tests. CI runs `pnpm build` as its own step, and runs the integration tests and the browser tests in the `database-integration` job.

## Run tests that need PostgreSQL

`pnpm db:test:up` runs `scripts/test-database.sh`, the one setup CI also uses. It replaces the Docker container `between-moves-test-db` on `127.0.0.1:55432`, turns on TLS, creates the least-privilege role `between_moves_app`, and writes the connection settings to `.test-database/env`. Set `TEST_DATABASE_CONTAINER` or `TEST_DATABASE_PORT` to pick another name or port. `pnpm db:test:down` removes the container and the settings.

The test runners read `TEST_DATABASE_URL` from the environment, or from `.test-database/env` when the variable is unset.

Each package's Vitest config has two projects. A file named `*.integration.test.ts` belongs to `integration`, and every other test file belongs to `unit`.

- `pnpm test` runs the `unit` project only. It never needs PostgreSQL, so turbo may replay it from cache.
- `pnpm test:integration` runs the `integration` project. Turbo never caches it. It checks the database once before it collects a file and fails with the setup command when the database is missing or unreachable. It also fails when any test skips or no test runs.
- `pnpm test:e2e` makes the same database check in `apps/web/playwright.config.ts`, applies every migration, and fails when any test skips.

Do not add a per-file skip guard for a missing database. `@between-moves/db/test-database` exports `requireTestDatabaseUrl`, which throws the setup message instead. `packages/db/src/season-closing.integration.test.ts` rolls every migration down, then up, before each test.

## Change the database

Add the next numbered directory under `packages/db/migrations/`, with `up.sql` and `down.sql`. That directory is the migration that `pnpm db:migrate` applies.

`pnpm db:generate` only drafts SQL from `packages/db/src/schema.ts` into `packages/db/migrations/generated/`. Git ignores that directory. Copy the SQL you want to keep into the numbered directory.

`pnpm db:migrate:down` reverses the latest migration. It throws when `APP_ENV` is `production`. The guard is `packages/db/src/migrate-cli.ts`.

## Deploy

Follow [ops/deploy.md](ops/deploy.md). The worker commands `trigger:dev` and `trigger:deploy` are scripts on `apps/worker`, not on the root package.
