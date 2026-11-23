# Between Moves

Between Moves is a private chess house for a small group of people who already know one another.

- Members play correspondence games, and they play live games during a night.
- An owner or a steward invites people, opens a season, and closes it.
- The house keeps standings, puzzles from finished games, and a closing book for the season.
- A signed-in person can export their data, and can delete their account after they transfer every active house they own.

Read [Architecture](ARCHITECTURE.md) for how the code fits together. Read [Contributing](CONTRIBUTING.md) before you change it. Deploy with [ops/deploy.md](ops/deploy.md). Pilot operators use the [pilot runbook](ops/pilot-runbook.md).

You need the tools and settings in this table.

| Requirement       | What to use                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Node.js           | 24 (`.node-version`). pnpm stops on a Node outside `engines.node` in any `package.json`.                 |
| pnpm              | 11.24.0, the `packageManager` field in `package.json`. Run it through Corepack, not a standalone binary. |
| PostgreSQL        | A `DATABASE_URL` whose query includes `sslmode=require`. CI uses PostgreSQL 16.10.                       |
| Web configuration | Every key in `apps/web/.env.example`. `BETTER_AUTH_SECRET` must be at least 32 characters.               |
| Trigger.dev       | 4.5.6, only when you deploy `apps/worker`.                                                               |

Install and start the web app from the repository root.

1. Enable the pinned pnpm.

   ```bash
   corepack enable
   ```

2. Install dependencies.

   ```bash
   pnpm install
   ```

3. Copy the web environment file and replace every placeholder.

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

4. Apply the reviewed SQL migrations. Export `DATABASE_URL` in the shell first. `pnpm db:migrate` reads that variable and does not read `apps/web/.env.local`. Point it at the database you mean to change.

   ```bash
   pnpm db:migrate
   ```

5. Start the web app.

   ```bash
   pnpm dev
   ```

Next.js loads `apps/web/.env.local` when `pnpm dev` starts the web app. `apps/web/src/instrumentation.ts` checks that environment with `loadConfig` and exits when a required value is missing or invalid. A database URL without `sslmode=require` fails that check, including on localhost.
