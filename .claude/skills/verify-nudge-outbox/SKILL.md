---
name: verify-nudge-outbox
description: Model-check Nudge delivery with TLA+. Use when a change touches Nudge scheduling or delivery (`dueNudgesAt`, `PgNudgeRepository`, `PgNudgeDeliveryGate`, the Nudge consumer or sender, the outbox dispatcher or `PgOutboxRepository`), when `pnpm formal:check` fails on `NudgeOutbox`, or to explain a Nudge counterexample.
---

# Verify the Nudge outbox

**Property.** The app calls Resend for a Nudge only after a gate read, made in that same attempt with the clock read for it, found the Nudge still due.

**Harm it prevents.** A player gets "It's your move" after they already moved, after the game ended, after the deadline it warns about (#62), or after their account closed.

The model is `architecture/models/nudge-outbox/NudgeOutbox.tla`. It defines four rules:

- `SentOnlyWhileDue` (invariant): the property above.
- `OneEmailPerEvent` (invariant): Resend sends at most one email per outbox event, across retries, lease loss and crashes.
- `DueNudgeSent` (liveness): a queued Nudge that stays due is eventually emailed. A reader that always skips fails it.
- `EventsSettle` (liveness): every queued event is eventually settled as sent or failed.

`NudgeOutbox.cfg` checks the two invariants with two workers. `NudgeOutboxLive.tla` only extends the model, so that `NudgeOutboxLive.cfg` can check the two liveness rules with one worker. Liveness with two workers takes too long to run on every change.

## Does the change touch the model?

Synced at: the commit that last changed this file. Last confirmed: 2026-11-22, when the Nudge delivery gate replaced `PgNudgeEmailReader` (#62). Squash merges rewrite commit ids, so this file marks the sync point. Find it and the covered files changed since:

```sh
sync=$(git log -1 --format=%H -- .claude/skills/verify-nudge-outbox/SKILL.md)
git diff --stat "$sync" -- \
  packages/db/src/due-nudges.ts packages/db/src/pg-nudge-repository.ts \
  packages/db/src/pg-nudge-delivery-gate.ts packages/db/src/outbox-repository.ts \
  packages/application/src/delivery/nudges.ts packages/application/src/delivery/nudge-email.ts \
  packages/application/src/delivery/dispatcher.ts packages/application/src/delivery/email.ts \
  packages/adapters/src/nudge-email.ts packages/adapters/src/resend-email-client.ts \
  packages/domain/src/delivery/index.ts apps/worker/src/composition.ts \
  packages/db/src/pg-submit-move-repository.ts packages/db/src/pg-game-completion-repository.ts \
  packages/db/src/pg-account-data-rights-repository.ts packages/db/src/pg-membership-departure.ts
```

Each action in the spec has the code path beside it. A change to a file above that changes what one transaction reads or writes, or the order of the steps in one delivery attempt, needs the model updated. A rename or a log line does not.

## Run the check

```sh
pnpm formal:check
```

It needs Java 17 or newer on `PATH` (`mise exec java@21 -- pnpm formal:check` works) or Docker. Each config finishes inside a 1 GB heap. `NudgeOutbox.cfg` explores 175,924 states in about 5 seconds, and `NudgeOutboxLive.cfg` 43,772 states in about 16 seconds, on one TLC worker. Each bug config stops at its first counterexample within seconds and under 10,000 states.

| Config                                        | Reader                            | Must                     |
| --------------------------------------------- | --------------------------------- | ------------------------ |
| `NudgeOutbox.cfg`                             | `gate`, this code                 | pass both invariants     |
| `NudgeOutboxLive.cfg`                         | `gate`, this code                 | pass both liveness rules |
| `NudgeOutbox.bug-send-after-turn-ended.cfg`   | `before_f80bd6f`                  | break `SentOnlyWhileDue` |
| `NudgeOutbox.bug-advance-after-deadline.cfg`  | `main_8bece64`, no deadline moves | break `SentOnlyWhileDue` |
| `NudgeOutboxLive.bug-reader-never-passes.cfg` | `never`                           | break `DueNudgeSent`     |

Read every TLC result with `/statechart`. It tells a counterexample as its shortest path in plain words. Run it on a copy of the spec outside `architecture/models/`, since that folder accepts only `.tla`, `.cfg` and `README.md`.

## Bounds and scale

Two workers for the invariants and one for liveness, plies 0 and 1, time 0 to 3 ticks, two attempts per event, one fault per run (a Resend failure, a timeout after Resend accepted, a worker crash, or a lease lost by a live worker). The first deadline is tick 2 and a reply sets the next deadline 2 ticks out. `DeadlineMoves` lets the first deadline move once by one tick at the same ply. No product code does that today; the integration test "the deadline moved at the same ply" does it by SQL.

A tick is the scale of the deadlines. The lease (30 s), the retry backoff (up to 5 minutes) and the Resend timeout are shorter than a tick, so time does not pass while a worker is mid-attempt or while an event is ready to claim. A retry lands in the same tick or the next one. Only the order of the long windows matters: the 24-hour advance window and the 23-hour retry cutoff are 2 ticks, and the Resend idempotency window (24 hours) is 3 ticks, longer than the cutoff.

`accountActive` stands for the House, the recipient's membership and the recipient's account together, which `dueNudgesAt` checks together.

## Real bug or modeling error?

Map each step of the trace to the code path beside its action. If the code can take those steps, in that order, inside those transactions, it is a real bug: reproduce it in `apps/web/src/server/nudge-delivery.integration.test.ts` (the #62 test there is the pattern) and report it. Never weaken a rule or the model to make it pass.

It is a modeling error when a step does something the code cannot, such as time passing during one Resend call, a step that spans two transactions, or a value the database constraints forbid. Fix the model and keep its comment paths true.

The model does not claim "still due when Resend accepts". The gate holds no lock across the network call, so a reply, a game end or an account change between the gate read and Resend can still let one email out for a turn that just closed. An action property `[][\A w \in Workers : (worker[w].pc = "passed" /\ Len(emails') > Len(emails)) => StillDue(outbox[worker[w].event])]_vars` breaks in five steps: queue, claim, gate passes, the player replies, Resend accepts. That window is accepted, not a finding.

Out of scope: the email text, Resend webhooks, the Nudge dispatcher's batch limit and order, and isolation levels beyond "one action is one transaction or one statement".

## Update the model for an intended change

1. Mirror the code change in the operator or action that has its path beside it: `DueRow` for `dueNudgesAt`, `GateRead` for the gate's join, an action for a step. `StillDue` and the four rules state the product rule, apart from the code. Change them only when the product decides that "due" means something else, and ask before you do.
2. If the change adds a step to a delivery attempt, add it as its own action. One action is one transaction or one statement.
3. Run `pnpm formal:check`. The main config must pass and every bug config must still fail for its rule.
4. When a past bug gets a fix, add a `NudgeOutbox.bug-<slug>.cfg` that replays it, and a `Reader` value for it in `GatePasses`.
5. After you confirm the model describes the code, update "Last confirmed" above with the date and the change, so this file's last commit moves forward.

## The chart

The Nudge chart in `ARCHITECTURE.md` comes from `/statechart` on `NudgeOutbox.tla` with `chart.cfg` (one worker, one turn, 423 states) and the view `chart-view.mjs`, both in this folder. Regenerate it the same way after a change that moves an arrow.
