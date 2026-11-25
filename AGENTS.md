# Between Moves

Private chess house for a small group. The workspace is `apps/web`, `apps/worker`, and the packages under `packages/`.

## Read this when

Read `ARCHITECTURE.md` when you change a package boundary, a season, a night, a game, or an open seat.

Read `CONTRIBUTING.md` when you run tests, format the repo, or change SQL.

Read `ops/deploy.md` when you deploy the web app or the worker.

## Rules that are easy to miss

pnpm stops with `ERR_PNPM_UNSUPPORTED_ENGINE` on a Node outside `engines.node`. The root and every workspace package declare it, so `pnpm <script>`, `pnpm -C <dir> <script>` and a script run inside a package directory all stop. A new workspace package must declare it too. Put the Node from `.node-version` first on `PATH` and run pnpm through Corepack, as the README says: `mise exec -- pnpm check`. A standalone pnpm binary (not the Corepack one) may check its own bundled Node instead of the one on `PATH`, and then fails on every script. `pnpm exec` and raw `node`, `turbo` and `eslint` calls skip the check.

`eslint.config.mjs` is the import allow-list. Each package `package.json` is the dependency list, and that list is narrower.

- `domain` may import `@between-moves/contracts` only with `import type`. It does not import it today, and `packages/domain/package.json` does not depend on it. Declare that dependency before you add the import.
- `application` may import `domain` and `contracts`. Its `package.json` depends on `domain` only.
- `db` and `adapters` may import `domain`, `contracts`, and `observability`. `application` is outside that list.
- `observability` imports no workspace package.
- `apps/worker` may import `application`, `domain`, `db`, `adapters`, `contracts`, and `observability`.

Those names are the lint allow-list. Add the workspace dependency to that package's `package.json` before you import it. Today only `apps/web` depends on `contracts`. Web configuration is `apps/web/src/config/index.ts`.

`pnpm lint:boundaries` covers the worker and the packages named in the root `package.json` script. It skips `apps/web` and `packages/contracts`. The web app uses `apps/web/eslint.config.mjs`. Contracts has no ESLint config in this repo.

Reviewed SQL in `packages/db/migrations/NNNN_name/` is the only copy of the database schema. Write each migration by hand as `up.sql` and `down.sql`. No ORM schema file exists. Repositories use `pg` and parse each row. `pnpm db:migrate:down` throws when `APP_ENV` is `production`. The check is in `packages/db/src/migrate-cli.ts`.

Point database integration tests at a disposable database. They read `TEST_DATABASE_URL` and skip when it is unset. `packages/db/src/season-closing.integration.test.ts` rolls every migration down before each test.

Phone and touch rules have three layers. `apps/web/src/app/globals.css` holds the base rules: fields at `max(1rem, 1em)` and a 24px `--target-size` floor on every control. `pnpm lint:css` (part of `pnpm lint`, source in `tooling/css-guards.mjs`) fails when a base rule changes, when a rule whose selector names `input`, `select` or `textarea` sets a `font-size` it cannot prove is 1rem or more or any `font` shorthand, when a rule outside the base sets `--target-size`, and on nested CSS it does not read. It cannot see a class on a field, a control's height, padding, layout or covers. `apps/web/e2e/phone-touch.spec.ts` measures those on the real page at 320 and 360 px: field text size, a 24x24 layout box and a free 24x24 square on every control, and overlap. `e2e/page-loading.spec.ts` fails on a preload the page does not use. Run `pnpm test:e2e` when you change a page's layout or CSS.

`pnpm check` runs the format check, lint, typecheck, and the test script. Run `pnpm format` when it reports formatting. It does not run `pnpm build`. CI runs that build as its own step. Run `pnpm traceability:check` when you change a BM-051 security criterion. Run `pnpm test:e2e` when you change a page. Run `pnpm formal:check` when you change a file in `architecture/models/`; `pnpm check` does not run it.

The traceability check handles three kinds of mapped file: Vitest files under `apps/web/src`, node:test files in `tooling`, and Playwright specs under `apps/web/e2e`. It runs each mapped Vitest and node:test file and counts a tagged `it` or `test` (title carries `[BM-051:AC-2]`, for example) only when the runner reports it passed. A failed test, file, suite or hook, or a nonzero runner exit, fails the file. The tagged test's own `expect(...).matcher(...)` calls (`assert` calls in node:test files), outside any test nested in it, must contain every word in the mapping's `asserts`; `not:word` needs a negated assertion, and under `.not` or `assert.notEqual` only the checked value (the first argument) can satisfy any other word. A tag on `describe` does not count. One mapped test per criterion must also assert every word in the criterion's `requires`. Playwright specs are read, not run: only plain `test(...)` calls count, and `skip`, `fixme`, `fail` or `only` anywhere in a mapped spec fails the check. The name `only` fails it anywhere in a mapped file (identifier, property or key, quoted or computed), and `fails` does the same in Vitest files. The CI job has no database, so map tests that run without `TEST_DATABASE_URL`.

Regenerate `tooling/traceability-matrix.md` with `pnpm traceability:generate`. Leave the generated file as the command wrote it.

When a House write emits an outbox event, write the state change and the event on the same database client. `snapshotAndEnqueueClosing` in `packages/db/src/pg-season-closing.ts` does that for `season.closing`.
