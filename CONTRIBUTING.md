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

`pnpm check` does not run `pnpm build`, the traceability check, the browser tests, or the formal models. CI runs `pnpm build` as its own step.

## Check a formal model

Models of concurrency and retry behavior are TLA+ files in `architecture/models/`. Put a model in that folder or in any subfolder, such as `architecture/models/nudge/`. Run them with TLC:

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

Add the next numbered directory under `packages/db/migrations/`, with `up.sql` and `down.sql`. That directory is the migration that `pnpm db:migrate` applies.

`pnpm db:generate` only drafts SQL from `packages/db/src/schema.ts` into `packages/db/migrations/generated/`. Git ignores that directory. Copy the SQL you want to keep into the numbered directory.

`pnpm db:migrate:down` reverses the latest migration. It throws when `APP_ENV` is `production`. The guard is `packages/db/src/migrate-cli.ts`.

## Deploy

Follow [ops/deploy.md](ops/deploy.md). The worker commands `trigger:dev` and `trigger:deploy` are scripts on `apps/worker`, not on the root package.
