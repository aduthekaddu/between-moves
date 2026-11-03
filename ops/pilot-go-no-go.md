# Pilot go or no-go record

Status: NO-GO until every row has staging evidence and a person approves launch.

Record the date, environment, owner, and artifact link for each check. A local test result is not a staging sign-off.

| Gate                                                                                                          | Status | Evidence required                        |
| ------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| 360 px and 768 px core pages, with zero serious or critical axe findings, keyboard access, and no overflow    | [ ]    | Staging Playwright report                |
| Core surface visual baselines reviewed                                                                        | [ ]    | Screenshot diff report                   |
| Navigation response budget under 5 seconds                                                                    | [ ]    | Staging Playwright report                |
| Full core loop end-to-end tests green                                                                         | [ ]    | Staging CI run                           |
| Required operations metrics emitted by every deployed instance                                                | [ ]    | Signal inventory and staging capture     |
| Move, delivery, realtime, security, infrastructure, and product dashboard views live                          | [ ]    | Dashboard links and owner                |
| Stale outbox alert fired and routed                                                                           | [ ]    | Alert and receiver acknowledgement       |
| Failed move write alert fired and routed                                                                      | [ ]    | Alert and receiver acknowledgement       |
| Cross-house authorization alert fired and routed                                                              | [ ]    | Alert and receiver acknowledgement       |
| Database saturation alert fired and routed                                                                    | [ ]    | Alert and receiver acknowledgement       |
| Zero cross-house denials in a clean staging soak                                                              | [ ]    | Time window and central log query        |
| Fail-closed configuration and least-privilege secrets verified                                                | [ ]    | Config test and access review            |
| Migration down and up rehearsal on an isolated staging copy                                                   | [ ]    | Restore drill record                     |
| Backup restore within the approved recovery-time target, with replay, standings, and isolation checks passing | [ ]    | Restore drill record and approved target |
| Product metrics sane on seeded data and reviewed on staging                                                   | [ ]    | Aggregate SQL outputs and sample sizes   |
| Pilot launch approved                                                                                         | [ ]    | Decision maker and timestamp             |

Local preparation on 2026-09-28 passed the seeded SQL test, the alert test-fire unit coverage, and the 360 px and 768 px Playwright matrix in the development workspace. A Docker restore rehearsal also passed, with one replayed move and zero integrity mismatches, in 5 seconds against a trial 900-second target. The record is [evidence/local-docker-restore-2026-09-28.json](evidence/local-docker-restore-2026-09-28.json). That file is development evidence only. The missing operations document leaves the approved recovery-time target and the alert recipient for the pilot owner to supply.

Day-to-day checks are in the [pilot runbook](pilot-runbook.md).
