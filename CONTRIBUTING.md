# Contributing

Set the machine up with the install steps in [README.md](README.md). The scripts below are the ones in the root `package.json` unless the step names another package.

## Check a change

1. Format the files you touched.

   ```bash
   pnpm format
   ```

2. Run lint, typecheck, and the test script.

   ```bash
   pnpm check
   ```

3. When the change touches a BM-051 security criterion, regenerate the matrix and check it.

   ```bash
   pnpm traceability:generate
   pnpm traceability:check
   ```

   `tooling/traceability-matrix.md` is generated. Leave it as the command wrote it.

4. When the change touches a page, run the browser tests.

   ```bash
   pnpm test:e2e
   ```

`pnpm check` does not run `pnpm build`, the traceability check, or the browser tests. CI runs `pnpm build` as its own step.

## Run tests that need PostgreSQL

Export `TEST_DATABASE_URL` and point it at a disposable database. Database integration tests skip when that variable is unset. `packages/db/src/season-closing.integration.test.ts` rolls every migration down, then up, before each test.

## Change the database

Add the next numbered directory under `packages/db/migrations/`, and write its `up.sql` and `down.sql` by hand. That directory is the migration that `pnpm db:migrate` applies.

The numbered migrations are the only copy of the schema. No ORM schema file mirrors them, so a schema change touches SQL only. Repositories in `packages/db/src/` query with `pg` and parse each row where it enters.

`pnpm db:migrate:down` reverses the latest migration. It throws when `APP_ENV` is `production`. The guard is `packages/db/src/migrate-cli.ts`.

## Deploy

Follow [ops/deploy.md](ops/deploy.md). The worker commands `trigger:dev` and `trigger:deploy` are scripts on `apps/worker`, not on the root package.
