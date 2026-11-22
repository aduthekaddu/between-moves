# Formal models

TLA+ models of concurrency and retry behavior, checked by TLC. Run them with `pnpm formal:check`.

For each module `<Name>.tla`:

- `<Name>.cfg` must pass.
- `<Name>.bug-<slug>.cfg` replays a past bug and must fail with an invariant or property violation. The run fails if it passes, or fails for any other reason.

See "Check a formal model" in [CONTRIBUTING.md](../../CONTRIBUTING.md).
