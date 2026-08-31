---
name: between-moves-context
description: Use for any work in Between Moves, especially BM tickets, product scope, domain terms, architecture boundaries, security, testing, or delivery decisions.
---

# Between Moves project contract

Do not duplicate the docs; read the source when the topic applies.

## Authority order (highest first)

1. `docs/product-and-mvp.md` — product intent, MVP scope, scoring, invitations, auth, platforms.
2. `docs/domain-language.md` — canonical product/code/data/test terminology.
3. `docs/spec/` — implementation behavior and technical design. Within it: numbered product/domain requirements control UX and technical docs; accepted ADRs control their stated decision; the more specific data/API/security contract controls detail.
4. `docs/system-design.md` — non-binding background; superseded by `04-architecture.md` and ADRs where they differ.

A derived requirement MUST NOT contradict 1 or 2. If sources conflict, follow this order and flag it.

## Read when

| Read this | When you are |
| --- | --- |
| `docs/product-and-mvp.md` | Clarifying scope, MVP boundaries, or product intent |
| `docs/domain-language.md` | Naming anything: copy, identifiers, tables, events, tests |
| `docs/spec/README.md` | Orienting in the spec suite or resolving authority |
| `docs/spec/01-product-requirements.md` | Working on personas, journeys, copy, metrics, analytics (PR-/AE-) |
| `docs/spec/02-domain-rules.md` | Implementing state machines, permissions, scoring, invariants (DR-) |
| `docs/spec/03-ux-and-visual-design.md` | Building routes, components, responsive/a11y behavior (UX-) |
| `docs/spec/04-architecture.md` | Touching layering, boundaries, runtime, transactions, SLOs |
| `docs/spec/05-data-model.md` | Changing tables, columns, constraints, indexes, ledgers |
| `docs/spec/06-api-events-and-jobs.md` | Defining HTTP contracts, event envelopes, channels, jobs |
| `docs/spec/07-security-and-privacy.md` | Handling auth, rate limits, data classification, retention |
| `docs/spec/08-testing-and-quality.md` | Writing tests, fixtures, or CI gates |
| `docs/spec/09-operations-and-pilot.md` | Touching environments, migrations, observability, runbooks |
| `docs/spec/10-delivery-plan.md` | Picking or scoping a BM ticket |
| `docs/spec/traceability.md` | Checking requirement coverage before/after a change |
| `docs/spec/adr/` | A decision affects runtime, state/realtime, auth, clocks, or background work |

## Workflow

1. Start from the active `BM-` ticket in `docs/spec/10-delivery-plan.md`. It names scope and cited requirements.
2. Read the requirement docs the ticket cites, then the relevant contract (05/06/07).
3. Write failing tests, then implement, then make them pass (TDD).
4. Cite requirement IDs in code and tests; update `traceability.md` and affected specs when behavior changes.
5. Keep to the ticket. No speculative scope: a convenient provider capability does not expand the MVP. Never introduce public Houses, stranger matchmaking, a global rating, native voice/video, or automated cheat detection (see PR-OUT).

## Terminology (canonical — see `docs/domain-language.md`)

Use exactly: **House** (not club/room/lobby), **Member** (not user/player when unseated), **Owner**, **Steward** (not moderator/co-owner), **House chat**, **Invitation** (not join request/public link), **Season**, **Charter** (not config), **Closing Book** (not wrapped/report), **House award** (not badge), **Season points** (not Elo/rating/XP), **Game**, **Correspondence game**, **Live game**, **Move shelf** (not queue/inbox), **Open seat** (not matchmaking), **House Puzzle**, **Between Moves Night** (not tournament), **Night host**, **Rail**, **Presence**, **Nudge** (not ping), **Game note**.

## Architecture boundaries (see `docs/spec/04-architecture.md`)

- `apps/web`, `apps/worker` — the only composition roots: wire concrete adapters into ports, own the request/task seam. No domain logic beyond wiring.
- `packages/domain` — pure: entities, value objects, policies, ports (interfaces). No I/O, no `fetch`, no `pg`, no framework types. Imports only type-only `contracts`.
- `packages/application` — use cases orchestrating domain + ports inside transactions. Imports `domain` and `contracts` only; depends on ports, never on `db`/`adapters` concretely.
- `packages/db`, `packages/adapters` — implement ports from `domain`. May import `domain`/`contracts`/`config`/`observability`. Must not import `application`.
- `packages/contracts` — wire-only types shared across boundaries.
- Cross-module calls go through the application layer's exported use-case functions, never direct table access.

## Code size and modularity

- Prefer backend/non-UI files under ~200 LOC and functions under ~50 LOC. When larger, split by responsibility.
- These are review triggers, not mandates: do not fragment cohesive logic artificially.
- CSS and cohesive frontend components may be longer when splitting would hurt readability.
- Keep modules cohesive; extract a package only when a second runtime needs it independently.

## Server authority and security (see `docs/spec/07-security-and-privacy.md`)

- The server is the sole authority for rules, permissions, scoring, and state. Never trust the client.
- PostgreSQL is the single source of truth; realtime is a transport, never a second state store.
- Authorization runs server-side through the House module's authority path. Secrets live on the server only; `packages/config` validates env at startup.

## Testing and validation

- TDD by default: failing test first. Cover concurrency and failure paths per `docs/spec/08-testing-and-quality.md`.
- Run validation from the repo root with pnpm before claiming done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Do not claim files or tests are complete until they pass.

## Terminal and tool rules

- Prefer `rg` and `fd`; use the shell only when a task genuinely requires it.
- Use `pnpm` only — never npm or yarn. Pin dependency versions exactly.
- No remote/curl-piped install scripts and no destructive commands.
- Never search `.git`, `node_modules`, `.next`, sessions, caches, vendor bundles, or minified files.
- Before reading a large file, check its size. Keep command output below 32 KB; write large results to an artifact and return only a summary.

## Git safety

- Never `git init`, create/switch branches, commit, amend, or push unless the user explicitly requests it.
- Never bypass hooks. No `reset --hard`, `clean -f`, or force push.

## This repo's ignore rules and documentation confinement

- `docs/` and `AGENTS.md` are intentionally git-ignored; do not change the ignore rules.
- Documentation-only work stays under `docs/`. Do not modify source, tests, scripts, CI, configuration, the root README, or generated artifacts to summarize or mirror docs.

## Session logs

- Keep one log per work session at `docs/logs/<branch-leaf>/<NNN>-<kebab-session>.md`; use `unbranched` when needed.
- Record timestamp, ticket/objective, branch, docs consulted, decisions, files touched, validation, and blockers. Never write secrets, tokens, or user content into a log.
