# Contributing

Set the machine up with the install steps in [README.md](README.md). The scripts below are the ones in the root `package.json` unless the step names another package.

## Check a change

1. Run the format check, lint, typecheck, and the test script.

   ```bash
   pnpm check
   ```

   When it reports formatting, run `pnpm format` and run `pnpm check` again. CI runs the same format check and fails the pull request on any unformatted file.

   Lint includes `pnpm lint:css`. It rejects a field `font-size` in `apps/web` CSS that it cannot prove is 1rem or more, and any change to the base rules in `globals.css`. Its message names the fix. Control sizes and covers are checked only by `pnpm test:e2e`.

2. When the change touches a BM-051 security criterion, regenerate the matrix and check it.

   ```bash
   pnpm traceability:generate
   pnpm traceability:check
   ```

   `tooling/traceability-matrix.md` is generated. Leave it as the command wrote it. `.prettierignore` lists it, so `pnpm format` does not touch it.

3. When the change touches a page, run the browser tests.

   ```bash
   pnpm test:e2e
   ```

`pnpm check` also runs `pnpm test:docs`. That test fails when a developer doc names a path, `pnpm` script, `@between-moves/*` package, or `symbol in file` that is not in the tree, or when the package diagram and the "may import" lists in `AGENTS.md` and `ARCHITECTURE.md` differ from the `package.json` files and `eslint.config.*`. It checks every `.md` file in the repo except `CHANGELOG.md` and the generated `tooling/traceability-matrix.md`. Update the doc in the same commit as the code.

The check reads one Mermaid diagram as the package diagram: the block that follows `<!-- doc-claims: package-diagram -->` in `ARCHITECTURE.md`. Keep that marker line, the `flowchart TD` header, and the `id["apps/name"]` and `a --> b` line forms. Other diagrams are not checked.

`pnpm check` does not run `pnpm build`, the traceability check, the browser tests, or the formal models. CI runs `pnpm build` as its own step.

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

Export `TEST_DATABASE_URL` and point it at a disposable database. Database integration tests skip when that variable is unset. `packages/db/src/season-closing.integration.test.ts` rolls every migration down, then up, before each test.

## Change the database

Add the next numbered directory under `packages/db/migrations/`, and write its `up.sql` and `down.sql` by hand. That directory is the migration that `pnpm db:migrate` applies.

The numbered migrations are the only copy of the schema. No ORM schema file mirrors them. Repositories in `packages/db/src/` query with `pg` and parse each row where it enters, so a schema change also updates the queries and row parsers that read the changed columns. `pnpm test` fails if a Drizzle dependency, config file, table declaration or `db:generate` script comes back (`tooling/migrations-only-schema.test.mjs`).

`pnpm db:migrate:down` reverses the latest migration. It throws when `APP_ENV` is `production`. The guard is `packages/db/src/migrate-cli.ts`.

## Deploy

Follow [ops/deploy.md](ops/deploy.md). The worker commands `trigger:dev` and `trigger:deploy` are scripts on `apps/worker`, not on the root package.
