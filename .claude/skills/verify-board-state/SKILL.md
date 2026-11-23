---
name: verify-board-state
description: Check the game board's client state against its TLA+ model. Use when you change board-machine.ts, board-store.ts, the page events in move-entry.tsx, the board wire parsers, or architecture/models/board/BoardState.tla, or when a board test, a board bug config, or the board conformance check fails.
---

# Verify the board state

The game board in `apps/web/src/app/h/[houseId]/games/[gameId]/` keeps its client state in one reducer, `transition` in `board-machine.ts`. Every late answer goes through it: a Move send, a read of the Game, the Undo timer, a realtime event. The reducer alone decides whether an answer applies. `architecture/models/board/BoardState.tla` models that reducer together with the server and an unordered network, where any request or answer can arrive in any order or fail.

## Rules

Each rule is an invariant or property in `BoardState.tla`. The harm says what a player sees when it breaks.

| Rule                   | It says                                                                                                                   | Harm when it breaks                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `StagedMoveStaysShown` | A staged or sending Move stays on the board until the player undoes it, the server answers it, or the Game moves past it. | The Undo bar says "You played e4" over the old position (fixed in 80fbdd8).                                  |
| `IdleBoardShowsNewest` | With no Move waiting and no review, the board shows the newest position the client knows.                                 | A failed send pulls the board back to a position older than one it already had (#63).                        |
| `NoAnswerDropped`      | The client never drops an answer newer than what it shows.                                                                | An opponent's Move or resignation stays hidden until the next poll (0840393).                                |
| `NoBoardFromNowhere`   | The client never knows a version or ply the server has not reached.                                                       | The board shows a position that never existed.                                                               |
| `DotFollowsBoard`      | The turn dot shows the side to move of the drawn position.                                                                | In review, the dot names the wrong side (#66).                                                               |
| `OneCurrentRead` | At most one read of the Game is current, and the reducer waits on it. An answer to an earlier read applies only when it is newer. | Two reads race and the older one decides the board. |
| `FreshHasNoAhead`      | An up-to-date board has no Move answer newer than its snapshot.                                                           | The board unlocks while it still shows a half-known position.                                                |
| `MoveNotLost`          | A staged Move leaves only by Undo or by being sent; a sending Move leaves only by its answer.                             | A Move vanishes with no message.                                                                             |
| `Settles`              | Once the server and the network go quiet, the board ends up to date, matching the server, with no Move waiting.           | The board stays on "Refreshing the board" for good. A reducer that does nothing would pass every other rule. |

The pass config `BoardState.cfg` checks all of them with `Variant = "machine"`. Each `BoardState.bug-<slug>.cfg` sets `Variant` to the old code and checks one rule, which must fail:

| Config                      | Old code                | Rule                   |
| --------------------------- | ----------------------- | ---------------------- |
| `bug-refresh-wipes-staged`  | before 80fbdd8          | `StagedMoveStaysShown` |
| `bug-staging-drops-read`    | 80fbdd8, before 0840393 | `NoAnswerDropped`      |
| `bug-stale-rollback`        | main at 8bece64 (#63)   | `IdleBoardShowsNewest` |
| `bug-refresh-wipes-sending` | main at 8bece64         | `StagedMoveStaysShown` |
| `bug-send-drops-read`       | main at 8bece64         | `NoAnswerDropped`      |
| `bug-review-dot`            | main at 8bece64 (#66)   | `DotFollowsBoard`      |

## Coverage

Each action in `BoardState.tla` names, in a comment above it, the reducer case or server code it mirrors. The model covers:

- `board-machine.ts`: `transition` and every case it calls, `liveBoard`, `shownPosition`, `canMove`.
- `board-store.ts`: each effect becomes one request (`readGame`, `sendMove`) or one timer (`startUndoTimer`).
- `move-entry-wire.ts`: `moveAnswer`, which sorts a send's answer into accepted, flag fall, conflict, rejected or unreachable.
- `move-entry.tsx`: which page events dispatch which reducer events. Focus, visibility, polls and realtime messages send `reconcileWanted`. Refresh board and a settled draw or resign send `refreshRequested`. Leaving the page sends `pageHidden`.

Synced at commit 48bfd77. The model describes those files as of that commit. After a change to them, move this commit forward only once the checks below pass and you have read the diff of the covered files against the model's actions.

## What it leaves out

- Message and alert text, selection, slides and sounds. The model sees the board, the Move waiting, and the read state.
- Real positions. A position is a ply of one fixed line of Moves, and a version is a number that only grows. Bounds are in `BoardState.cfg`.
- Game end, clocks, the live viewport and going offline. The model's page is always online, visible and wide enough.
- The page's buttons appear as action guards: a poll waits while a Move is staged or sending, a foreground read happens only in live play, and stepping back needs at least one Move.
- The old-code variants use the drawn board's version where the old code kept a separate `positionVersion`. They differ only after a 409.

## Run the checks

Run these from the repo root. The first needs no Java. The others need Java 17 or newer, or Docker.

1. `pnpm --filter @between-moves/web exec vitest run board-machine move-entry` runs the reducer tests, the page tests that replay past bugs, and the conformance walk. The walk takes about 15 seconds.
2. `pnpm formal:check` runs TLC on the pass config and every bug config. About 20 seconds.
3. `pnpm formal:board-conformance` hashes the graph TLC finds at the bounds in `board-conformance.json`. About 10 seconds.

Done means all three pass.

## Read a failure

- **`BoardState.cfg` fails in `pnpm formal:check`.** TLC printed a counterexample. Read it with the `/statechart` skill, which tells the shortest path to the broken rule in plain words. Replay that path in `board-machine.test.ts` as events, one per action, using the comment above each action to find its reducer case. If the reducer does the same, the bug is real: fix the reducer. If it does not, the model is wrong: fix the model.
- **A bug config passes.** The model can no longer catch that past bug, because a variant branch or a rule got weaker. Restore it.
- **The conformance walk fails in step 1.** The reducer and the model take different steps from some state. Write both graphs out and compare them:

  ```bash
  BOARD_GRAPH_OUT=/tmp/board-code.txt pnpm --filter @between-moves/web exec vitest run board-machine.conformance
  BOARD_GRAPH_OUT=/tmp/board-model.txt pnpm formal:board-conformance
  diff <(sort /tmp/board-model.txt) <(sort /tmp/board-code.txt) | head
  ```

  Edge lines are `<from> <action> <to>`. State lines are `state <id> <variables as JSON>`. Find the first state that has an edge on one side only. That step is where the two disagree.

- **Step 3 fails and step 1 passes.** The model changed and `board-conformance.json` did not. If the change is intended, follow the next section.

## Change the board on purpose

1. Change the reducer and the model together. Keep the comment above each model action pointing at its reducer case.
2. A new reducer event needs a model action, and a step in `clientSteps` in `board-machine.conformance.test.ts`. A new server or network behavior needs a model action and a step in `environmentSteps`.
3. Run `node tooling/board-conformance.mjs --write`, then the three checks above.
4. A new rule that guards a past bug gets a `BoardState.bug-<slug>.cfg` that fails on the old code.
5. Move the sync commit.
