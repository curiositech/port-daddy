# Behaviour-oriented task decomposition

## Scheduling model

Under the ordinary JADE behaviour scheduler, an agent runs its ready behaviours cooperatively and non-preemptively on its execution thread. Explicit threaded-behaviour configurations require their own synchronization design. `action()` returns to yield. `block()` takes effect after return and a message, timer, or explicit restart can make the behaviour ready. A Java stack is not retained, so keep phase, matched reply, and attempts in fields or `DataStore`.

## Composition choices

Use `OneShotBehaviour` for setup, `CyclicBehaviour` for repeated queue checks, `SequentialBehaviour` for ordered local steps, and `FSMBehaviour` for protocol/failure branches. `ParallelBehaviour` with `WHEN_ALL`/`WHEN_ANY` defines composite termination; it does not make child or remote work CPU-parallel. Do not run expensive or blocking work in `action()`.

## CFP FSM

`PREPARE → COLLECT → SELECT → AWAIT_REPORT → VERIFY` has branches to `NO_SELECTION`, `REPORTED_FAILURE`, `MISSING_REPORT`, and `INVALID_OUTPUT`. Store conversation ID, request digest, `reply-with`, and replies; do not correlate by sender/topic alone.

```java
public void action() {
  ACLMessage m = myAgent.receive(template);
  if (m == null) { block(); return; }
  if (!expectedRole(m.getSender()) || !validContent(m)) { recordRejected(m); return; }
  recordReply(m); advanceFsm();
}
```

Official JADE Programmer’s Guide and [Behaviour](https://jade.tilab.com/doc/api/jade/core/behaviours/Behaviour.html)/[ParallelBehaviour](https://jade.tilab.com/doc/api/jade/core/behaviours/ParallelBehaviour.html) v4.6.0, accessed 2026-09-24, support these semantics, not throughput guarantees.
