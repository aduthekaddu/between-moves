---- MODULE InitBug ----
\* Fixture for tooling/formal-check.test.mjs. The invariant fails in the initial state, which is
\* still a genuine catch: TLC prints "Invariant InRange is violated by the initial state:".
EXTENDS Naturals

VARIABLE x

Init == x = 5
Next == x' = x
Spec == Init /\ [][Next]_x

InRange == x < 3
====
