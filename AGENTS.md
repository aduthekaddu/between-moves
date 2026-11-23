# Between Moves

Private chess house for a small group. The workspace is `apps/web`, `apps/worker`, and the packages under `packages/`.

## Read this when

Read `ARCHITECTURE.md` when you change a package boundary, a season, a night, a game, or an open seat.

Read `CONTRIBUTING.md` when you run tests, format the repo, or change SQL.

Read `ops/deploy.md` when you deploy the web app or the worker.

## Rules that are easy to miss

Use the Node and pnpm versions pinned in `package.json`.

`eslint.config.mjs` is the import allow-list. Each package `package.json` is the dependency list, and that list is narrower.

- `domain` may import `@between-moves/contracts` only with `import type`. It does not import it today, and `packages/domain/package.json` does not depend on it. Declare that dependency before you add the import.
- `application` may import `domain` and `contracts`. Its `package.json` depends on `domain` only.
- `db` and `adapters` may import `domain`, `contracts`, `observability`, and `@between-moves/config`. `application` is outside that list.
- `observability` imports no workspace package.
- `apps/worker` may import `application`, `domain`, `db`, `adapters`, `contracts`, `observability`, and `@between-moves/config`.

Those names are the lint allow-list. Add the workspace dependency to that package's `package.json` before you import it. Today only `apps/web` depends on `contracts`. No package depends on `@between-moves/config`. Web configuration is `apps/web/src/config/index.ts`.

`pnpm lint:boundaries` covers the worker and the packages named in the root `package.json` script. It skips `apps/web` and `packages/contracts`. The web app uses `apps/web/eslint.config.mjs`. Contracts has no ESLint config in this repo.

Reviewed SQL lives in `packages/db/migrations/NNNN_name/`. `pnpm db:generate` writes a draft under `packages/db/migrations/generated/`, and git ignores that directory. `pnpm db:migrate:down` throws when `APP_ENV` is `production`. The check is in `packages/db/src/migrate-cli.ts`.

Point database integration tests at a disposable database. They read `TEST_DATABASE_URL` and skip when it is unset. `packages/db/src/season-closing.integration.test.ts` rolls every migration down before each test.

`pnpm check` runs lint, typecheck, and the test script. It does not run `pnpm build`. CI runs that build as its own step. Run `pnpm traceability:check` when you change a BM-051 security criterion. Run `pnpm test:e2e` when you change a page.

The traceability check handles three kinds of mapped file: Vitest files under `apps/web/src`, node:test files in `tooling`, and Playwright specs under `apps/web/e2e`. It runs each mapped Vitest and node:test file and counts a tagged `it` or `test` (title carries `[BM-051:AC-2]`, for example) only when the runner reports it passed. A failed test, file, suite or hook, or a nonzero runner exit, fails the file. The tagged test's own `expect(...).matcher(...)` calls (`assert` calls in node:test files), outside any test nested in it, must contain every word in the mapping's `asserts`; `not:word` needs a negated assertion. A tag on `describe` does not count. One mapped test per criterion must also assert every word in the criterion's `requires`. Playwright specs are read, not run: only plain `test(...)` calls count, and `skip`, `fixme`, `fail` or `only` anywhere in a mapped spec fails the check. `.only` fails it in every mapped file, and `.fails` in Vitest files. The CI job has no database, so map tests that run without `TEST_DATABASE_URL`.

Regenerate `tooling/traceability-matrix.md` with `pnpm traceability:generate`. Leave the generated file as the command wrote it.

When a House write emits an outbox event, write the state change and the event on the same database client. `snapshotAndEnqueueClosing` in `packages/db/src/pg-season-closing.ts` does that for `season.closing`.
