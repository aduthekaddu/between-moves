# Pilot operations

Use this when you are checking the pilot on staging. The operations document that this runbook used to cite is not in the repo. Set the approved recovery-time target and the alert receiver before the staging exercise. This repository does not define either value.

The web metrics in the process are local stubs. Compare the signal list below with staging logs before you treat the dashboard as complete.

## Build the six dashboard views

Use one central JSON log stream from every web and worker instance, and a read-only PostgreSQL connection. Filter logs by `event` and `ts`. Keep `house_id`, `actor_id`, and `command_id` out of dashboard labels and alert payloads.

| View           | Source and fields                                                                                                    | What you check                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Move           | `game.move-accepted`, `game.move-write-failed`, `game.move-rejected`, and `duration_ms`                              | Accepted rate, p95 latency, and unexpected write failures              |
| Delivery       | `delivery.outbox-dispatch-complete` data fields `outbox_age_seconds`, `outbox_retry_total`, and `email_failure_rate` | A stalled queue and retries                                            |
| Realtime       | `realtime.token-issued`, and the worker snapshot fields `realtime_publish_*`                                         | Token and publish failures                                             |
| Security       | `house.authorization-denied` with `data.cross_house`, and `rate-limit.store-unavailable`                             | Any cross-house denial in a clean soak, and fail-closed store behavior |
| Infrastructure | `/healthz`, `db.connection-failed`, and `pg_stat_activity` against `max_connections`                                 | Readiness and connection saturation                                    |
| Product        | `pnpm pilot:metrics`, plus `bm.closing_book.viewed` in the central logs                                              | 28-day participation and return visits to a closing book               |

Generate the private six-view HTML dashboard with `PILOT_DASHBOARD_PATH` and `pnpm pilot:dashboard`. Refresh it on the staging scheduler and serve it only to operators. The page has aggregate numbers and no member or house identifiers. A missing worker snapshot shows `n/a`. Worker snapshots are one invocation each, not a running total. Aggregate events over time. Do not add repeated snapshot values together as if they were Prometheus counters.

## Poll alerts and fire each route

Give the runner a read-only `PGUSER`, `PGHOST`, `PGDATABASE`, and `PGSSLMODE=require`. Also give it `PILOT_LOG_FILE`, a central JSONL stream, and an HTTPS `ALERT_WEBHOOK_URL`. Schedule `pnpm pilot:alerts` once a minute. The command fails when either source is unavailable, so monitor the runner itself.

The receiver should collapse repeated `signal` values and route the four named signals to the pilot on-call channel. The thresholds are an oldest pending outbox event of at least 300 seconds, any unexpected move write failure in five minutes, any cross-house denial in five minutes, and database connection use of at least 80 percent.

Fire each route on its own and save the receiver acknowledgement and the destination.

```bash
pnpm pilot:alerts --test-fire=stale_outbox
pnpm pilot:alerts --test-fire=failed_move_writes
pnpm pilot:alerts --test-fire=cross_house_authz
pnpm pilot:alerts --test-fire=db_saturation
```

A test fire sets `test_fire` to true. The local tests show that the payload is built and that a route response is handled. Only the staging receiver shows that delivery happened.

## Rehearse restore and the latest migration

Create a custom-format backup with `pg_dump -Fc` from the approved backup process. Set `APP_ENV=staging`, an explicit staging `PGHOST`, `PGUSER`, and `PGSSLMODE=require`. Set `BACKUP_FILE`, a fresh `RESTORE_DB_NAME` of the form `bm_restore_<unique_suffix>`, `RESTORE_RECORD_PATH`, and the approved `RTO_TARGET_SECONDS`. The role must be able to create the isolated database and run migrations on it.

The script refuses a target database that already exists. With `APP_ENV=staging` it also refuses a localhost host. Only `APP_ENV=staging` and `APP_ENV=local` are accepted. Any other value, including `production`, is refused. Do not point it at the application database.

```bash
pnpm pilot:restore-drill
```

The drill restores into the new database, reverses and reapplies the latest migration, replays each stored UCI move through the pinned chess rules library, compares each stored FEN and the game head, recomputes frozen standings points and ranks, and checks cross-house references. It writes a JSON result with the measured recovery time even when it fails. Keep the isolated database for inspection, then delete it under the staging change procedure.

For a disposable Docker rehearsal, use `APP_ENV=local` with `PGHOST=127.0.0.1` and a custom-format backup from that container. The script records `environment` as `local`. That run is development evidence and cannot satisfy the staging launch gate. Use PostgreSQL client tools that match the container major version. The local recovery-time number is a trial threshold until the pilot owner supplies the approved target.

## Read the product query

Run `pnpm pilot:metrics` with a read-only `PG*` connection. Save the five aggregate rows and the sample sizes. Rates must sit between zero and one. A zero sample is not yet evidence of engagement. The median is in hours.

Count repeat closing-book readers from the central `bm.closing_book.viewed` log, by actor and season, and leave the owner out. Views are not stored in the database, so the SQL cannot produce that count.

## Decide the staging soak

Run the full end-to-end loop, the 360 px and 768 px accessibility matrix, the screenshot comparison, and the performance budget against a production build. Review the alert receiver, the restore record, the product outputs, and the [go or no-go record](pilot-go-no-go.md). Launch waits for a person to approve it after every security and isolation row is checked.
