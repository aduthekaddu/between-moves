# Between Moves

Your chess house. A private chess house for a small group that already knows one another.

This repository is a pnpm + Turborepo monorepo. The MVP scaffold (BM-001) contains a single
Next.js App Router application in `apps/web`.

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

| Command             | Description                                   |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Start the web app in development (`next dev`) |
| `pnpm build`        | Build all packages (`next build`)             |
| `pnpm lint`         | Lint with ESLint                              |
| `pnpm typecheck`    | Type-check with `tsc --noEmit`                |
| `pnpm test`         | Run tests with `vitest run`                   |
| `pnpm check`        | Run lint, typecheck, and test together        |
| `pnpm format`       | Format the repo with Prettier                 |
| `pnpm format:check` | Check formatting without writing              |

## Workspace layout

```
apps/web        Next.js App Router application
packages/*      Reserved for future workspace packages (none yet)
```
