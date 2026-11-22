---- MODULE Counter ----
\* Fixture for tooling/formal-check.test.mjs. A counter that must stop at Limit.
\* The check runner uses it to prove that a bug config can fail.
EXTENDS Naturals

CONSTANT Limit

VARIABLE x

vars == <<x>>

Init == x = 0

Step == x < Limit /\ x' = x + 1

\* Bug: the guard is off by one, so x can pass Limit.
BuggyStep == x <= Limit /\ x' = x + 1

\* Finished, so TLC does not report a deadlock.
Done == x = Limit /\ UNCHANGED vars

Next == Step \/ Done
BuggyNext == BuggyStep \/ Done

Spec == Init /\ [][Next]_vars /\ WF_vars(Step)
BuggySpec == Init /\ [][BuggyNext]_vars /\ WF_vars(BuggyStep)
\* No fairness: the counter may stay at 0 forever.
LazySpec == Init /\ [][Next]_vars

Bounded == x <= Limit
Finishes == <>(x = Limit)
====
