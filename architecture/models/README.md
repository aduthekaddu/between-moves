# Formal models

TLA+ models of concurrency and retry behavior, checked by TLC. Run them with `pnpm formal:check`.

Put a model in this folder or in any subfolder, such as `nudge/`. Each folder is checked on its own, so a module and its configs share a folder. Every file must be a `.tla`, a `.cfg` or a `README.md`. The run fails on any other file, so a renamed or misplaced file cannot go unchecked.

For each module `<Name>.tla`:

- `<Name>.cfg` must pass.
- `<Name>.bug-<slug>.cfg` replays a past bug and must fail with an invariant or property violation. The run fails if it passes, or fails for any other reason.

See "Check a formal model" in [CONTRIBUTING.md](../../CONTRIBUTING.md).
