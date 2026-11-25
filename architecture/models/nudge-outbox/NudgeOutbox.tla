---- MODULE NudgeOutbox ----
EXTENDS Naturals, Sequences

CONSTANTS Workers, Reader, MaxPly, MaxTime, FirstDueAt, PerMove, AdvanceWindow,
          RetryCutoff, ProviderWindow, MaxAttempts, MaxFaults, DeadlineMoves

VARIABLES now, ply, dueAt, gameActive, accountActive, outbox, worker, accepted, emails, faults

game == <<now, ply, dueAt, gameActive, accountActive>>
vars == <<game, outbox, worker, accepted, emails, faults>>

Stages == {"advance", "overdue"}
MaxEvents == (MaxPly + 1) * 2
Idle == [pc |-> "idle", event |-> 0, attempt |-> 0, dueAtGate |-> FALSE, outcome |-> "none"]

StillDue(e) ==
  /\ gameActive /\ accountActive
  /\ ply = e.ply /\ dueAt = e.dueAt
  /\ IF e.stage = "advance" THEN now < dueAt ELSE dueAt <= now

\* packages/db/src/due-nudges.ts dueNudgesAt: a row for the current turn, with its stage at now
DueRow(s) ==
  /\ gameActive /\ accountActive
  /\ s = IF dueAt <= now THEN "overdue" ELSE "advance"

\* packages/db/src/pg-nudge-delivery-gate.ts PgNudgeDeliveryGate.pass: dueNudgesAt joined on the delivery's key, stage and move_due_at
GateRead(e) == DueRow(e.stage) /\ ply = e.ply /\ dueAt = e.dueAt

\* git show f80bd6f^:packages/db/src/pg-nudge-email-reader.ts and 8bece64:packages/db/src/pg-nudge-email-reader.ts
GatePasses(e) ==
  CASE Reader = "gate" -> GateRead(e)
    [] Reader = "main_8bece64" -> gameActive /\ accountActive /\ ply = e.ply
    [] Reader = "before_f80bd6f" -> accountActive
    [] Reader = "never" -> FALSE

Queued(s) == \E i \in 1..Len(outbox) : outbox[i].ply = ply /\ outbox[i].stage = s

Claimable(i) ==
  /\ outbox[i].settled = "no" /\ ~outbox[i].leased
  /\ outbox[i].availableAt <= now

HeldByLiveWorker(i) == \E w \in Workers : worker[w].pc # "idle" /\ worker[w].event = i

Init ==
  /\ now = 0 /\ ply = 0 /\ dueAt = FirstDueAt
  /\ gameActive = TRUE /\ accountActive = TRUE
  /\ outbox = <<>>
  /\ worker = [w \in Workers |-> Idle]
  /\ accepted = {} /\ emails = <<>> /\ faults = 0

\* packages/application/src/delivery/nudges.ts createNudgeDispatcher; packages/db/src/pg-nudge-repository.ts findDue, enqueue, lockCurrentNudge
Enqueue(s) ==
  /\ DueRow(s)
  /\ s = "advance" => dueAt <= now + AdvanceWindow
  /\ ~Queued(s)
  /\ outbox' = Append(outbox, [ply |-> ply, stage |-> s, dueAt |-> dueAt, occurredAt |-> now,
                               availableAt |-> now, leased |-> FALSE, attempts |-> 0,
                               settled |-> "no"])
  /\ UNCHANGED <<game, worker, accepted, emails, faults>>

\* packages/db/src/outbox-repository.ts PgOutboxRepository.claimBatch (candidates)
Claim(w, i) ==
  /\ worker[w].pc = "idle"
  /\ Claimable(i) /\ outbox[i].attempts < MaxAttempts
  /\ outbox' = [outbox EXCEPT ![i].attempts = @ + 1, ![i].leased = TRUE]
  /\ worker' = [worker EXCEPT ![w] = [Idle EXCEPT !.pc = "claimed", !.event = i,
                                        !.attempt = outbox[i].attempts + 1]]
  /\ UNCHANGED <<game, accepted, emails, faults>>

\* packages/db/src/outbox-repository.ts PgOutboxRepository.claimBatch (parked)
Park(i) ==
  /\ Claimable(i) /\ outbox[i].attempts >= MaxAttempts
  /\ outbox' = [outbox EXCEPT ![i].settled = "failed"]
  /\ UNCHANGED <<game, worker, accepted, emails, faults>>

\* packages/application/src/delivery/nudge-email.ts createNudgeEmailConsumer consume: clock, retry cutoff, gate.pass
Gate(w) ==
  /\ worker[w].pc = "claimed"
  /\ LET e == outbox[worker[w].event] IN
       worker' = [worker EXCEPT ![w] =
                    IF now - e.occurredAt >= RetryCutoff
                    THEN [@ EXCEPT !.pc = "settling", !.outcome = "failed"]
                    ELSE IF GatePasses(e)
                         THEN [@ EXCEPT !.pc = "passed", !.dueAtGate = StillDue(e)]
                         ELSE [@ EXCEPT !.pc = "settling", !.outcome = "processed"]]
  /\ UNCHANGED <<game, outbox, accepted, emails, faults>>

\* packages/adapters/src/resend-email-client.ts ResendEmailClient.send: Idempotency-Key is the outbox event id
Accept(w) ==
  LET i == worker[w].event IN
  IF \E a \in accepted : a[1] = i /\ now - a[2] < ProviderWindow
  THEN UNCHANGED <<accepted, emails>>
  ELSE /\ accepted' = accepted \cup {<<i, now>>}
       /\ emails' = Append(emails, [event |-> i, dueAtGate |-> worker[w].dueAtGate])

\* packages/application/src/delivery/dispatcher.ts dispatchOne: attempts >= maxAttempts
AfterFailure(w) == IF worker[w].attempt >= MaxAttempts THEN "failed" ELSE "retry"

\* packages/adapters/src/nudge-email.ts ResendNudgeEmailSender.sendNudge; packages/adapters/src/resend-email-client.ts RESEND_REQUEST_TIMEOUT_MS
Call(w) ==
  /\ worker[w].pc = "passed"
  /\ \/ /\ Accept(w)
        /\ worker' = [worker EXCEPT ![w].pc = "settling", ![w].outcome = "processed"]
        /\ UNCHANGED faults
     \/ /\ faults < MaxFaults
        /\ Accept(w)
        /\ worker' = [worker EXCEPT ![w].pc = "settling", ![w].outcome = AfterFailure(w)]
        /\ faults' = faults + 1
     \/ /\ faults < MaxFaults
        /\ UNCHANGED <<accepted, emails>>
        /\ worker' = [worker EXCEPT ![w].pc = "settling", ![w].outcome = AfterFailure(w)]
        /\ faults' = faults + 1
  /\ UNCHANGED <<game, outbox>>

\* packages/application/src/delivery/dispatcher.ts dispatchOne, retryAt; packages/db/src/outbox-repository.ts markSent, releaseForRetry, markFailed
Settle(w) ==
  /\ worker[w].pc = "settling"
  /\ LET i == worker[w].event
         o == worker[w].outcome IN
       IF outbox[i].settled # "no"
       THEN UNCHANGED outbox
       ELSE CASE o = "processed" -> outbox' = [outbox EXCEPT ![i].settled = "sent", ![i].leased = FALSE]
              [] o = "failed" -> outbox' = [outbox EXCEPT ![i].settled = "failed", ![i].leased = FALSE]
              [] o = "retry" ->
                   \E delay \in IF now < MaxTime THEN {0, 1} ELSE {0} :
                     outbox' = [outbox EXCEPT ![i].leased = FALSE,
                                              ![i].availableAt = now + delay]
  /\ worker' = [worker EXCEPT ![w] = Idle]
  /\ UNCHANGED <<game, accepted, emails, faults>>

\* apps/worker/src/trigger: a Trigger.dev run stops mid-attempt
Crash(w) ==
  /\ worker[w].pc \in {"claimed", "passed", "settling"}
  /\ faults < MaxFaults
  /\ worker' = [worker EXCEPT ![w] = Idle]
  /\ faults' = faults + 1
  /\ UNCHANGED <<game, outbox, accepted, emails>>

\* packages/application/src/delivery/dispatcher.ts DEFAULT_LEASE_MS; packages/db/src/outbox-repository.ts claimBatch available_at <= now
LeaseExpires(i) ==
  /\ outbox[i].settled = "no" /\ outbox[i].leased
  /\ \/ ~HeldByLiveWorker(i) /\ UNCHANGED faults
     \/ HeldByLiveWorker(i) /\ faults < MaxFaults /\ faults' = faults + 1
  /\ outbox' = [outbox EXCEPT ![i].leased = FALSE, ![i].availableAt = now]
  /\ UNCHANGED <<game, worker, accepted, emails>>

\* packages/db/src/pg-submit-move-repository.ts PgSubmitMoveRepository.submit
Reply ==
  /\ gameActive /\ accountActive /\ ply < MaxPly
  /\ ply' = ply + 1 /\ dueAt' = now + PerMove
  /\ UNCHANGED <<now, gameActive, accountActive, outbox, worker, accepted, emails, faults>>

\* packages/db/src/pg-game-completion-repository.ts PgGameCompletionRepository; packages/db/src/pg-submit-move-repository.ts PgSubmitMoveRepository.submit
EndGame ==
  /\ gameActive /\ accountActive /\ gameActive' = FALSE
  /\ UNCHANGED <<now, ply, dueAt, accountActive, outbox, worker, accepted, emails, faults>>

\* packages/db/src/pg-account-data-rights-repository.ts deleteAccount; packages/db/src/pg-membership-departure.ts removeMembershipInPostgres, leaveMembershipInPostgres
Deactivate ==
  /\ gameActive /\ accountActive /\ accountActive' = FALSE
  /\ UNCHANGED <<now, ply, dueAt, gameActive, outbox, worker, accepted, emails, faults>>

\* apps/web/src/server/nudge-delivery.integration.test.ts "the deadline moved at the same ply"
MoveDeadline ==
  /\ DeadlineMoves /\ gameActive /\ ply = 0 /\ dueAt = FirstDueAt
  /\ dueAt' = dueAt + 1
  /\ UNCHANGED <<now, ply, gameActive, accountActive, outbox, worker, accepted, emails, faults>>

\* packages/adapters/src/system-clock.ts SystemClock.now
Tick ==
  /\ now < MaxTime
  /\ \A w \in Workers : worker[w].pc = "idle"
  /\ \A i \in 1..Len(outbox) :
       outbox[i].settled = "no" => (~outbox[i].leased /\ outbox[i].availableAt > now)
  /\ now' = now + 1
  /\ UNCHANGED <<ply, dueAt, gameActive, accountActive, outbox, worker, accepted, emails, faults>>

Done == UNCHANGED vars

ClaimAny(w) == \E i \in 1..Len(outbox) : Claim(w, i)
ParkAny == \E i \in 1..Len(outbox) : Park(i)
LeaseExpiresAny == \E i \in 1..Len(outbox) : LeaseExpires(i)

Next ==
  \/ \E s \in Stages : Enqueue(s)
  \/ \E w \in Workers : ClaimAny(w) \/ Gate(w) \/ Call(w) \/ Settle(w) \/ Crash(w)
  \/ ParkAny \/ LeaseExpiresAny
  \/ Reply \/ EndGame \/ Deactivate \/ MoveDeadline \/ Tick \/ Done

Fairness ==
  /\ \A s \in Stages : WF_vars(Enqueue(s))
  /\ \A w \in Workers : WF_vars(ClaimAny(w)) /\ WF_vars(Gate(w)) /\ WF_vars(Call(w))
                        /\ WF_vars(Settle(w))
  /\ WF_vars(ParkAny) /\ WF_vars(LeaseExpiresAny) /\ WF_vars(Tick)

Spec == Init /\ [][Next]_vars /\ Fairness

SentOnlyWhileDue == \A k \in 1..Len(emails) : emails[k].dueAtGate

OneEmailPerEvent ==
  \A k, m \in 1..Len(emails) : k # m => emails[k].event # emails[m].event

EventDue(i) == i <= Len(outbox) /\ StillDue(outbox[i])
Emailed(i) == \E k \in 1..Len(emails) : emails[k].event = i
Settled(i) == i <= Len(outbox) /\ outbox[i].settled # "no"

DueNudgeSent == \A i \in 1..MaxEvents : EventDue(i) ~> (Emailed(i) \/ ~EventDue(i))
EventsSettle == \A i \in 1..MaxEvents : (i <= Len(outbox)) ~> Settled(i)
====
