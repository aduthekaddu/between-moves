# BM-052 pilot go/no-go record

Status: **NO-GO** until every row is supported by staging evidence and launch is approved.
Record the date, environment, owner, and artifact link for each check. Never convert a
local test result into a staging sign-off.

| Gate                                                                                           | Status | Evidence required                        |
| ---------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| 360 px and 768 px core pages: zero serious/critical axe findings, keyboard access, no overflow | [ ]    | Staging Playwright report                |
| Core surface visual baselines reviewed                                                         | [ ]    | Screenshot diff report                   |
| Navigation response budget under 5 seconds                                                     | [ ]    | Staging Playwright report                |
| Full core loop E2E green                                                                       | [ ]    | Staging CI run                           |
| Required operations metrics emitted by every deployed instance                                 | [ ]    | Signal inventory and staging capture     |
| Move, delivery, realtime, security, infrastructure, product dashboard views live               | [ ]    | Dashboard links and owner                |
| Stale outbox alert fired and routed                                                            | [ ]    | Alert and receiver acknowledgment        |
| Failed Move write alert fired and routed                                                       | [ ]    | Alert and receiver acknowledgment        |
| Cross-House authorization alert fired and routed                                               | [ ]    | Alert and receiver acknowledgment        |
| Database saturation alert fired and routed                                                     | [ ]    | Alert and receiver acknowledgment        |
| Zero cross-House denials in clean staging soak                                                 | [ ]    | Time window and central log query        |
| Fail-closed configuration and least-privilege secrets verified                                 | [ ]    | Config test and access review            |
| Migration down/up rehearsal on isolated staging copy                                           | [ ]    | Restore drill record                     |
| Backup restore within approved RTO, replay/standings/isolation checks pass                     | [ ]    | Restore drill record and approved target |
| Product metrics sane on seeded data and reviewed on staging                                    | [ ]    | Aggregate SQL outputs and sample sizes   |
| Pilot launch approved                                                                          | [ ]    | Decision maker and timestamp             |

Local preparation: the seeded SQL test, alert test-fire unit coverage, and the 360/768
Playwright matrix passed in the development workspace on 2026-09-28. A Docker PostgreSQL
16 restore rehearsal also passed with one replayed Move, two scored standings, and zero
integrity mismatches in 5 seconds against a trial 900-second target
([record](evidence/local-docker-restore-2026-09-28.json)). These are
development evidence only. The missing operations document leaves the approved RTO
target and alert recipient to be supplied by the pilot owner.
