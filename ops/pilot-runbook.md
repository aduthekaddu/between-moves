# BM-052 pilot operations runbook

The referenced 09-operations document is unavailable. These checks use the current schema,
structured log events, and worker delivery snapshot. Set the approved RTO and alert receiver
before the staging exercise; this repository does not define either value.
The existing web metrics are process-local stubs. Verify the full required signal inventory
against staging logs before treating this dashboard as coverage of every operations metric.

## Six dashboard views

Use one central JSON log stream from **all** web and worker instances and the read-only
PostgreSQL connection. Filter logs by `event` and `ts`; keep `house_id`, `actor_id`, and
`command_id` out of dashboard labels and alert payloads.

| View           | Source and fields                                                                                          | Operator check                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Move           | `game.move-accepted`, `game.move-write-failed`, `game.move-rejected`; `duration_ms`                        | accepted rate, p95 latency, unexpected write failures            |
| Delivery       | `delivery.outbox-dispatch-complete` data: `outbox_age_seconds`, `outbox_retry_total`, `email_failure_rate` | stalled queue and retries                                        |
| Realtime       | `realtime.token-issued`, worker delivery snapshot `realtime_publish_*`                                     | token and publish failures                                       |
| Security       | `house.authorization-denied` with `data.cross_house`, `rate-limit.store-unavailable`                       | any cross-House denial in clean soak; fail-closed store behavior |
| Infrastructure | `/healthz`, `db.connection-failed`, `pg_stat_activity` / `max_connections`                                 | readiness and connection saturation                              |
| Product        | `pnpm pilot:metrics`, plus `bm.closing_book.viewed` in central logs                                        | 28-day participation and Closing Book return                     |

Generate the private six-view HTML dashboard with `PILOT_DASHBOARD_PATH` and
`pnpm pilot:dashboard`; refresh it on the staging scheduler and serve it only to operators.
It contains aggregate numbers, no Member or House identifiers. Missing worker snapshots
display `n/a`. The worker snapshots are per invocation, not cumulative counters. Aggregate
events over time; do not sum repeated snapshot values as if they were process-wide
Prometheus counters.

## Alert polling and route exercise

Give the runner a read-only `PGUSER`, `PGHOST`, `PGDATABASE`, `PGSSLMODE=require`,
`PILOT_LOG_FILE` containing the central JSONL stream, and an HTTPS `ALERT_WEBHOOK_URL`.
Schedule `pnpm pilot:alerts` once per minute. It fails if either source is unavailable;
monitor the runner itself. The receiver should deduplicate repeated `signal` values and
route the four named signals to the pilot on-call channel. Thresholds: oldest pending
outbox event ≥ 300 seconds, any unexpected Move write failure in five minutes, any
cross-House denial in five minutes, and database connection use ≥ 80%.

Fire each route independently and save the receiver acknowledgment and destination:

```bash
pnpm pilot:alerts --test-fire=stale_outbox
pnpm pilot:alerts --test-fire=failed_move_writes
pnpm pilot:alerts --test-fire=cross_house_authz
pnpm pilot:alerts --test-fire=db_saturation
```

Test fires carry `test_fire: true`. The local tests prove payload construction and route
response handling; only the staging receiver can prove actual delivery.

## Restore and migration rehearsal

Create a custom-format backup with `pg_dump -Fc` using the approved backup process. Set
`APP_ENV=staging`, an explicit staging `PGHOST`, `PGUSER`, `PGSSLMODE=require`,
`BACKUP_FILE`, a fresh `RESTORE_DB_NAME=bm_restore_<unique_suffix>`,
`RESTORE_RECORD_PATH`, and the approved `RTO_TARGET_SECONDS`. The role must be able to
create the isolated database and run migrations on it. The script refuses localhost,
production, and an existing target database. Do not point it at the application database.

```bash
pnpm pilot:restore-drill
```

The drill restores into the new database, reverses and reapplies the latest migration,
replays each canonical UCI Move through the pinned chess rules library, compares each
stored FEN and the Game head, recomputes frozen standings points and ranks, and checks
cross-House references. It writes a JSON result with measured RTO even on failure. Keep
the isolated database for inspection, then delete it under the staging change procedure.

For a disposable Docker rehearsal, use `APP_ENV=local` with `PGHOST=127.0.0.1` and a
custom-format backup from that container. The script records `environment: local`; this
run is development evidence and cannot satisfy the staging launch gate. Use PostgreSQL
client tools matching the container's major version. The local RTO value is a trial
threshold until the pilot owner supplies the approved target.

## Product query

Run `pnpm pilot:metrics` with a read-only `PG*` connection. Save the five aggregate rows
and sample sizes. Rates must be between zero and one; a zero sample means the metric is
not yet evidence of engagement. The median is in hours. Count repeat Closing Book
readers from the central `bm.closing_book.viewed` log by actor and season, excluding the
Owner; it cannot be derived from the database because views are not persisted there.

## Staging soak and launch gate

Run the full E2E loop, the two-width accessibility matrix, screenshot comparison, and
performance budget against a production build. Review the alert receiver, the restore
record, product outputs, and the go/no-go sheet. Require an explicit human pilot launch
approval after every security and isolation row is checked.
