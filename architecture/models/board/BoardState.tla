---- MODULE BoardState ----
EXTENDS Naturals, FiniteSets

CONSTANTS Variant, Modes, MaxVersion, MaxPly, MaxCommands, MaxFailures

Machine == Variant = "machine"
NotReviewing == MaxPly + 1
NoAhead == [has |-> FALSE, v |-> 0, p |-> 0]
NoCommand == [kind |-> "none", id |-> 0, base |-> 0]

VARIABLES server, accepted, mode, snap, sync, cmd, rv, net, nextCmd, fails, heard,
          canon, captured, drawn, screen

core == <<server, accepted, mode, snap, sync, cmd, rv, net, nextCmd, fails, heard,
          canon, captured, drawn>>
vars == <<core, screen>>

Msg(type, cur, ok, v, p, id, base, kind) ==
  [type |-> type, cur |-> cur, ok |-> ok, v |-> v, p |-> p, id |-> id, base |-> base, kind |-> kind]
GetReq == Msg("get", TRUE, TRUE, 0, 0, 0, 0, "none")
IsRead(m) == m.type \in {"get", "getr"}
Max(a, b) == IF a > b THEN a ELSE b
ViewerTurn(p) == p % 2 = 0
Side(p) == IF p % 2 = 0 THEN "white" ELSE "black"
Fresh(reading) == [kind |-> "fresh", reading |-> reading, bg |-> TRUE, again |-> FALSE, ahead |-> NoAhead]
Kept(ahead, s) == IF ahead.has /\ ahead.v > s.v THEN ahead ELSE NoAhead

LiveBoard ==
  IF Machine
  THEN IF sync.ahead.has THEN [v |-> sync.ahead.v, p |-> sync.ahead.p] ELSE snap
  ELSE canon
Known == LiveBoard.v
Pending == cmd.kind \in {"staged", "sending"}
Reviewing == rv < snap.p
BoardShown ==
  IF Reviewing THEN [kind |-> "review", p |-> rv]
  ELSE IF ~Machine THEN drawn
  ELSE IF Pending /\ cmd.base = LiveBoard.p THEN [kind |-> "preview", p |-> cmd.base + 1]
  ELSE [kind |-> "live", p |-> LiveBoard.p]
Dot == IF Machine THEN Side(screen.p) ELSE Side(snap.p)
CanMove == sync.kind = "fresh" /\ ViewerTurn(snap.p) /\ cmd.kind \in {"none", "retryable"}

Init ==
  /\ server = [v |-> 0, p |-> 0]
  /\ accepted = [i \in 1..MaxCommands |-> NoAhead]
  /\ mode \in Modes
  /\ snap = [v |-> 0, p |-> 0]
  /\ sync = Fresh(FALSE)
  /\ cmd = NoCommand
  /\ rv = NotReviewing
  /\ net = {}
  /\ nextCmd = 1
  /\ fails = 0
  /\ heard = 0
  /\ canon = [v |-> 0, p |-> 0]
  /\ captured = [v |-> 0, p |-> 0]
  /\ drawn = [kind |-> "live", p |-> 0]
  /\ screen = BoardShown

Orphaned(n) == {IF IsRead(m) THEN [m EXCEPT !.cur = FALSE] ELSE m : m \in n}

StartRead(bg) ==
  IF sync.reading
  THEN UNCHANGED <<sync, net>>
  ELSE /\ sync' = IF bg /\ sync.kind = "fresh" THEN Fresh(TRUE)
                  ELSE [kind |-> "stale", reading |-> TRUE, bg |-> bg, again |-> FALSE, ahead |-> sync.ahead]
       /\ net' = net \cup {GetReq}

Send(id, base) ==
  /\ cmd' = [kind |-> "sending", id |-> id, base |-> base]
  /\ IF Machine
     THEN /\ net' = net \cup {Msg("post", TRUE, TRUE, 0, 0, id, base, "none")}
          /\ UNCHANGED <<sync, captured, drawn>>
     ELSE /\ net' = Orphaned(net) \cup {Msg("post", TRUE, TRUE, 0, 0, id, base, "none")}
          /\ sync' = [sync EXCEPT !.reading = FALSE]
          /\ captured' = canon
          /\ drawn' = IF base = canon.p THEN [kind |-> "preview", p |-> base + 1]
                      ELSE [kind |-> "live", p |-> canon.p]

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition squareTapped -> commit
Commit ==
  /\ CanMove
  /\ nextCmd <= MaxCommands
  /\ nextCmd' = nextCmd + 1
  /\ rv' = NotReviewing
  /\ IF mode = "live"
     THEN Send(nextCmd, LiveBoard.p)
     ELSE /\ cmd' = [kind |-> "staged", id |-> nextCmd, base |-> LiveBoard.p]
          /\ UNCHANGED captured
          /\ IF Machine
             THEN UNCHANGED <<sync, net, drawn>>
             ELSE /\ drawn' = [kind |-> "preview", p |-> canon.p + 1]
                  /\ IF Variant = "before0840393"
                     THEN /\ sync' = [sync EXCEPT !.reading = FALSE]
                          /\ net' = Orphaned(net)
                     ELSE UNCHANGED <<sync, net>>
  /\ UNCHANGED <<server, accepted, mode, snap, fails, heard, canon>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition squareTapped -> tapSquare
DismissRetry ==
  /\ cmd.kind = "retryable" /\ CanMove
  /\ cmd' = NoCommand
  /\ UNCHANGED <<server, accepted, mode, snap, sync, rv, net, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition undoPressed
Undo ==
  /\ cmd.kind = "staged"
  /\ cmd' = NoCommand
  /\ drawn' = IF Machine THEN drawn ELSE [kind |-> "live", p |-> canon.p]
  /\ UNCHANGED <<server, accepted, mode, snap, sync, rv, net, nextCmd, fails, heard, canon, captured>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition undoWindowEnded -> releaseStaged
UndoTimerFires ==
  /\ cmd.kind = "staged"
  /\ Send(cmd.id, cmd.base)
  /\ UNCHANGED <<server, accepted, mode, snap, rv, nextCmd, fails, heard, canon>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition pageHidden -> releaseStaged
PageHides ==
  /\ cmd.kind = "staged"
  /\ Send(cmd.id, cmd.base)
  /\ UNCHANGED <<server, accepted, mode, snap, rv, nextCmd, fails, heard, canon>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition retryPressed
Retry ==
  /\ cmd.kind = "retryable"
  /\ Send(cmd.id, cmd.base)
  /\ UNCHANGED <<server, accepted, mode, snap, rv, nextCmd, fails, heard, canon>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition reconcileWanted
Reconcile(bg) ==
  /\ ~Pending
  /\ mode = "live" \/ bg
  /\ StartRead(bg)
  /\ UNCHANGED <<server, accepted, mode, snap, cmd, rv, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition refreshRequested
RefreshPressed ==
  /\ StartRead(FALSE)
  /\ UNCHANGED <<server, accepted, mode, snap, cmd, rv, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition reviewStepped
StepBack ==
  /\ snap.p > 0 /\ rv # 0
  /\ rv' = IF Reviewing THEN rv - 1 ELSE snap.p - 1
  /\ UNCHANGED <<server, accepted, mode, snap, sync, cmd, net, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition reviewShown
BackToGame ==
  /\ rv # NotReviewing
  /\ rv' = NotReviewing
  /\ UNCHANGED <<server, accepted, mode, snap, sync, cmd, net, nextCmd, fails, heard, canon, captured, drawn>>

\* packages/db/src/pg-game-completion-repository.ts and the draw offer writes
ServerBumps ==
  /\ server.v < MaxVersion
  /\ server' = [server EXCEPT !.v = @ + 1]
  /\ UNCHANGED <<accepted, mode, snap, sync, cmd, rv, net, nextCmd, fails, heard, canon, captured, drawn>>

\* packages/db/src/pg-submit-move-repository.ts from the opponent, or this seat in another tab
ServerMoves ==
  /\ server.v < MaxVersion /\ server.p < MaxPly
  /\ server' = [v |-> server.v + 1, p |-> server.p + 1]
  /\ UNCHANGED <<accepted, mode, snap, sync, cmd, rv, net, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/api/houses/[houseId]/games/[gameId]/route.ts GET
ServerAnswersRead(m) ==
  /\ m.type = "get"
  /\ net' = (net \ {m}) \cup {[m EXCEPT !.type = "getr", !.v = server.v, !.p = server.p]}
  /\ UNCHANGED <<server, accepted, mode, snap, sync, cmd, rv, nextCmd, fails, heard, canon, captured, drawn>>

\* packages/db/src/pg-submit-move-repository.ts submitMove, which replays a known clientCommandId
ServerAnswersMove(m) ==
  /\ m.type = "post"
  /\ LET a == accepted[m.id]
         answer(kind, v, p) == (net \ {m}) \cup {Msg("postr", TRUE, TRUE, v, p, m.id, m.base, kind)}
     IN \/ /\ a.has
           /\ net' = answer("accepted", a.v, a.p)
           /\ UNCHANGED <<server, accepted>>
        \/ /\ ~a.has /\ m.base = server.p /\ server.v < MaxVersion /\ server.p < MaxPly
           /\ server' = [v |-> server.v + 1, p |-> server.p + 1]
           /\ accepted' = [accepted EXCEPT ![m.id] = [has |-> TRUE, v |-> server.v + 1, p |-> server.p + 1]]
           /\ net' = answer("accepted", server.v + 1, server.p + 1)
        \/ /\ ~a.has /\ m.base # server.p
           /\ net' = answer("conflict", server.v, server.p)
           /\ UNCHANGED <<server, accepted>>
        \/ /\ ~a.has
           /\ net' = answer("rejected", 0, 0)
           /\ UNCHANGED <<server, accepted>>
        \/ /\ ~a.has /\ mode = "live" /\ server.v < MaxVersion
           /\ server' = [server EXCEPT !.v = @ + 1]
           /\ net' = answer("flag", 0, 0)
           /\ UNCHANGED accepted
  /\ UNCHANGED <<mode, snap, sync, cmd, rv, nextCmd, fails, heard, canon, captured, drawn>>

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-store.ts readGame and sendMove catch
NetworkFails(m) ==
  /\ fails < MaxFailures
  /\ fails' = fails + 1
  /\ \/ /\ IsRead(m) /\ m.ok
        /\ net' = (net \ {m}) \cup {[m EXCEPT !.type = "getr", !.ok = FALSE, !.v = 0, !.p = 0]}
     \/ /\ m.type = "post"
        /\ net' = (net \ {m}) \cup {Msg("postr", TRUE, TRUE, 0, 0, m.id, m.base, "unreachable")}
     \/ /\ m.type = "postr" /\ m.kind # "unreachable"
        /\ net' = (net \ {m}) \cup {[m EXCEPT !.kind = "unreachable", !.v = 0, !.p = 0]}
  /\ UNCHANGED <<server, accepted, mode, snap, sync, cmd, rv, nextCmd, heard, canon, captured, drawn>>

RetryCleared(bg, v) ==
  IF cmd.kind = "retryable" /\ (~bg \/ v # Known) THEN NoCommand ELSE cmd

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition readAnswered
ReadArrives(m) ==
  /\ m.type = "getr"
  /\ heard' = IF m.ok THEN Max(heard, m.v) ELSE heard
  /\ IF ~(m.cur /\ sync.reading)
     THEN /\ net' = net \ {m}
          /\ UNCHANGED <<snap, sync, cmd, canon, drawn>>
     ELSE IF Machine /\ sync.again
     THEN LET fresher == m.ok /\ m.v > snap.v
              s2 == IF fresher THEN [v |-> m.v, p |-> m.p] ELSE snap
          IN /\ snap' = s2
             /\ cmd' = IF fresher THEN RetryCleared(sync.bg, m.v) ELSE cmd
             /\ sync' = [sync EXCEPT !.again = FALSE, !.ahead = Kept(sync.ahead, s2)]
             /\ net' = (net \ {m}) \cup {GetReq}
             /\ UNCHANGED <<canon, drawn>>
     ELSE /\ net' = net \ {m}
          /\ IF ~m.ok \/ m.v < Known
             THEN /\ sync' = [kind |-> "failed", reading |-> FALSE, bg |-> TRUE, again |-> FALSE, ahead |-> sync.ahead]
                  /\ UNCHANGED <<snap, cmd, canon, drawn>>
             ELSE /\ snap' = [v |-> m.v, p |-> m.p]
                  /\ cmd' = RetryCleared(sync.bg, m.v)
                  /\ sync' = Fresh(FALSE)
                  /\ canon' = IF Machine THEN canon ELSE [v |-> m.v, p |-> m.p]
                  /\ drawn' = IF ~Machine /\ (Variant = "before80fbdd8" \/ cmd.kind # "staged")
                              THEN [kind |-> "live", p |-> m.p] ELSE drawn
  /\ UNCHANGED <<server, accepted, mode, rv, nextCmd, fails, captured>>

ReadAfterAnswer(ahead, s, n) ==
  IF sync.reading
  THEN /\ sync' = [kind |-> "stale", reading |-> TRUE, bg |-> FALSE, again |-> Machine, ahead |-> Kept(ahead, s)]
       /\ net' = n
  ELSE /\ sync' = [kind |-> "stale", reading |-> TRUE, bg |-> FALSE, again |-> FALSE, ahead |-> Kept(ahead, s)]
       /\ net' = n \cup {GetReq}

\* apps/web/src/app/h/[houseId]/games/[gameId]/board-machine.ts transition moveAnswered
MoveArrives(m) ==
  /\ m.type = "postr"
  /\ heard' = IF m.kind \in {"accepted", "conflict"} THEN Max(heard, m.v) ELSE heard
  /\ LET n == net \ {m}
         board == [has |-> TRUE, v |-> m.v, p |-> m.p]
         newer == m.kind \in {"accepted", "conflict"} /\ m.v > Known
     IN IF cmd.kind # "sending" \/ m.id # cmd.id
        THEN /\ net' = n
             /\ UNCHANGED <<snap, sync, cmd, canon, captured, drawn>>
        ELSE IF Machine
        THEN CASE m.kind = "accepted" /\ newer /\ mode = "correspondence" ->
                    /\ snap' = [v |-> m.v, p |-> m.p] /\ cmd' = NoCommand
                    /\ ReadAfterAnswer(sync.ahead, [v |-> m.v, p |-> m.p], n)
                    /\ UNCHANGED <<canon, captured, drawn>>
               [] newer ->
                    /\ cmd' = NoCommand /\ ReadAfterAnswer(board, snap, n)
                    /\ UNCHANGED <<snap, canon, captured, drawn>>
               [] m.kind \in {"accepted", "conflict", "flag"} ->
                    /\ cmd' = NoCommand /\ ReadAfterAnswer(sync.ahead, snap, n)
                    /\ UNCHANGED <<snap, canon, captured, drawn>>
               [] m.kind = "rejected" ->
                    /\ cmd' = NoCommand /\ net' = n
                    /\ UNCHANGED <<snap, sync, canon, captured, drawn>>
               [] OTHER ->
                    /\ cmd' = [cmd EXCEPT !.kind = "retryable"] /\ net' = n
                    /\ UNCHANGED <<snap, sync, canon, captured, drawn>>
        ELSE CASE m.kind \in {"accepted", "conflict"} ->
                    /\ canon' = [v |-> m.v, p |-> m.p]
                    /\ snap' = IF mode = "correspondence" THEN [v |-> m.v, p |-> m.p] ELSE snap
                    /\ drawn' = [kind |-> "live", p |-> m.p]
                    /\ cmd' = NoCommand /\ ReadAfterAnswer(NoAhead, snap, n)
                    /\ UNCHANGED captured
               [] m.kind = "flag" ->
                    /\ drawn' = [kind |-> "live", p |-> captured.p]
                    /\ cmd' = NoCommand /\ ReadAfterAnswer(NoAhead, snap, n)
                    /\ UNCHANGED <<snap, canon, captured>>
               [] m.kind = "rejected" ->
                    /\ drawn' = [kind |-> "live", p |-> captured.p]
                    /\ cmd' = NoCommand /\ net' = n
                    /\ UNCHANGED <<snap, sync, canon, captured>>
               [] OTHER ->
                    /\ drawn' = [kind |-> "live", p |-> captured.p]
                    /\ cmd' = [cmd EXCEPT !.kind = "retryable"] /\ net' = n
                    /\ UNCHANGED <<snap, sync, canon, captured>>
  /\ UNCHANGED <<server, accepted, mode, rv, nextCmd, fails>>

ServerAnswers == \E m \in net : ServerAnswersRead(m) \/ ServerAnswersMove(m)
Delivery == \E m \in net : ReadArrives(m) \/ MoveArrives(m)

Step ==
  \/ Commit \/ DismissRetry \/ Undo \/ UndoTimerFires \/ PageHides \/ Retry
  \/ Reconcile(TRUE) \/ Reconcile(FALSE) \/ RefreshPressed \/ StepBack \/ BackToGame
  \/ ServerBumps \/ ServerMoves \/ ServerAnswers \/ Delivery
  \/ \E m \in net : NetworkFails(m)

Next == Step /\ screen' = BoardShown'

Spec == Init /\ [][Next]_vars

FairSpec ==
  /\ Spec
  /\ WF_core(UndoTimerFires)
  /\ WF_core(Reconcile(TRUE))
  /\ WF_core(\E m \in net : ServerAnswersRead(m))
  /\ WF_core(\E m \in net : ServerAnswersMove(m))
  /\ WF_core(\E m \in net : ReadArrives(m))
  /\ WF_core(\E m \in net : MoveArrives(m))

StagedMoveStaysShown ==
  Pending /\ ~Reviewing /\ cmd.base = LiveBoard.p
    => screen = [kind |-> "preview", p |-> cmd.base + 1]

IdleBoardShowsNewest ==
  ~Pending /\ ~Reviewing => screen = [kind |-> "live", p |-> LiveBoard.p]

NoAnswerDropped == Known >= heard

NoBoardFromNowhere == Known <= server.v /\ LiveBoard.p <= server.p

DotFollowsBoard == Dot = Side(screen.p)

OneReadAtATime ==
  LET reads == {m \in net : IsRead(m)}
  IN Cardinality(reads) <= 1 /\ (sync.reading <=> reads # {})

FreshHasNoAhead == sync.kind = "fresh" => ~sync.ahead.has

MoveNotLost ==
  [][Pending /\ cmd' # cmd =>
       \/ cmd.kind = "staged" /\ cmd'.kind = "sending" /\ cmd'.id = cmd.id
       \/ cmd.kind = "staged" /\ Undo
       \/ cmd.kind = "sending" /\ \E m \in net : m.type = "postr" /\ m.id = cmd.id /\ m \notin net']_vars

Settles == []<>(sync.kind = "fresh" /\ snap = server /\ ~Pending)
====
