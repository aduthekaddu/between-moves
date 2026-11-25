# Contributing

Set the machine up with the install steps in [README.md](README.md). The scripts below are the ones in the root `package.json` unless the step names another package.

## Check a change

1. Start the disposable TLS PostgreSQL once per session. It needs Docker and `openssl`. `pnpm check` runs the integration tests, so it needs this database.

   ```bash
   pnpm db:test:up
   ```

2. Run the format check, lint, typecheck, the unit tests, and the PostgreSQL integration tests.

   ```bash
   pnpm check
   ```

   When it reports formatting, run `pnpm format` and run `pnpm check` again. CI runs the same format check and fails the pull request on any unformatted file.

   Lint includes `pnpm lint:css`. It rejects a field `font-size` in `apps/web` CSS that it cannot prove is 1rem or more, and any change to the base rules in `globals.css`. Its message names the fix. Control sizes and covers are checked only by `pnpm test:e2e`.

3. When the change touches a BM-051 security criterion, regenerate the matrix and check it.

   ```bash
   pnpm traceability:generate
   pnpm traceability:check
   ```

   `tooling/traceability-matrix.md` is generated. Leave it as the command wrote it. `.prettierignore` lists it, so `pnpm format` does not touch it.

4. When the change touches a page, run the browser tests.

   ```bash
   pnpm test:e2e
   ```

`pnpm check` also runs `pnpm test:docs`. That test fails when a developer doc names a path, `pnpm` script, `@between-moves/*` package, or `symbol in file` that is not in the tree, or when the package diagram and the "may import" lists in `AGENTS.md` and `ARCHITECTURE.md` differ from the `package.json` files and `eslint.config.*`. It checks every `.md` file in the repo except `CHANGELOG.md` and the generated `tooling/traceability-matrix.md`. Update the doc in the same commit as the code.

The check reads one Mermaid diagram as the package diagram: the block that follows `<!-- doc-claims: package-diagram -->` in `ARCHITECTURE.md`. Keep that marker line, the `flowchart TD` header, and the `id["apps/name"]` and `a --> b` line forms. Other diagrams are not checked.

`pnpm check` does not run `pnpm build`, the traceability check, the browser tests, or the formal models. CI runs `pnpm build` as its own step, and runs the integration tests and the browser tests in the `database-integration` job.

## Check a formal model

Models of concurrency and retry behavior are TLA+ files in `architecture/models/`. Put a model in that folder or in a subfolder of it. Run them with TLC:

```bash
pnpm formal:check
```

The script downloads a pinned `tla2tools.jar` into `~/.cache/between-moves/` on first use. Set `FORMAL_CACHE_DIR` to use another folder; a relative path counts from where you run the script. It needs Java 17 or newer on `PATH`, or Docker, which runs a pinned Java 21 image. It runs every config on one worker, so a counterexample is the same on every run.

Each folder is checked on its own, so a module and its configs share a folder. For each module `<Name>.tla`:

- `<Name>.cfg` must pass. A failure is a counterexample trace: a sequence of states that breaks an invariant or property. Either the code the model describes allows that sequence, or the model is wrong. Decide which before you change anything.
- `<Name>.bug-<slug>.cfg` replays a past bug and must fail with an invariant or property violation. A bug config that passes means the model no longer catches that bug. A bug config that fails with a parse, config or deadlock error is not a catch either. Both fail the run.

A `.tla` file with no `<Name>.cfg` in its folder, a bug config with no `<Name>.cfg` or `<Name>.tla` in its folder, and any other config name also fail the run. So does any file that is not a `.tla`, a `.cfg` or a `README.md`, such as `Name.cfg.disabled`. The script rejects arguments other than `--models <dir>`.

`pnpm formal:selftest` checks the runner itself against `tooling/formal-fixtures/`. It needs Java or Docker too, so `pnpm check` does not run it. CI runs it, then `pnpm formal:check`, in the `formal-models` job.

## Run tests that need PostgreSQL

`pnpm db:test:up` runs `scripts/test-database.sh`, the one setup CI also uses. It replaces the Docker container `between-moves-test-db` on `127.0.0.1:55432`, turns on TLS, creates the least-privilege role `between_moves_app`, and writes the connection settings to `.test-database/env`. Set `TEST_DATABASE_CONTAINER` or `TEST_DATABASE_PORT` to pick another name or port. `pnpm db:test:down` removes the container and the settings.

The test runners read `TEST_DATABASE_URL` from the environment, or from `.test-database/env` when the variable is unset.

`packages/db` and `apps/web` split their Vitest tests into two projects. A file named `*.integration.test.ts` or `*.integration.test.tsx` belongs to `integration`, and every other test file belongs to `unit`. No other package has the `integration` project, and `pnpm test` fails when an integration test file sits in one. To add one there, spread `databaseTestProjects` from `@between-moves/db/test-database/vitest` into its Vitest config and copy the `test` and `test:integration` scripts from `packages/db/package.json`.

- `pnpm test` runs the `unit` project only. It never needs PostgreSQL, so turbo may replay it from cache.
- `pnpm test:integration` runs the `integration` project. Turbo never caches it. It checks the database once before it collects a file and fails with the setup command when the database is missing or unreachable. It also fails when any test skips or no test runs.
- `pnpm test:e2e` makes the same database check in `apps/web/playwright.config.ts`, applies every migration, and fails when any test skips. It starts its own web server on port 3100 with the test database's runtime role, and stops when `DATABASE_URL` names any other database.

Do not add a per-file skip guard for a missing database. `@between-moves/db/test-database` exports `requireTestDatabaseUrl`, which throws the setup message instead. ESLint rejects `TEST_DATABASE_URL` and `TEST_RUNTIME_DATABASE_URL` in any file outside `packages/db/src/test-database/`. `packages/db/src/season-closing.integration.test.ts` rolls every migration down, then up, before each test.

## Change the database

Add the next numbered directory under `packages/db/migrations/`, and write its `up.sql` and `down.sql` by hand. That directory is the migration that `pnpm db:migrate` applies.

The numbered migrations are the only copy of the schema. No ORM schema file mirrors them. Repositories in `packages/db/src/` query with `pg` and parse each row where it enters, so a schema change also updates the queries and row parsers that read the changed columns. `pnpm test` fails if a Drizzle dependency, config file, table declaration or `db:generate` script comes back (`tooling/migrations-only-schema.test.mjs`).

`pnpm db:migrate:down` reverses the latest migration. It throws when `APP_ENV` is `production`. The guard is `packages/db/src/migrate-cli.ts`.

## Deploy

Follow [ops/deploy.md](ops/deploy.md). The worker commands `trigger:dev` and `trigger:deploy` are scripts on `apps/worker`, not on the root package.
