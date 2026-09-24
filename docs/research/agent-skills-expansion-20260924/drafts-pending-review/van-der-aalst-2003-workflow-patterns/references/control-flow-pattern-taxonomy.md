# Control-flow taxonomy and exact boundaries

The 2003 paper identifies twenty control-flow patterns: (1) Sequence, (2) Parallel
Split, (3) Synchronization, (4) Exclusive Choice, (5) Simple Merge, (6) Multiple
Choice, (7) Synchronizing Merge, (8) Multi-Merge, (9) Discriminator, (10) Arbitrary
Cycles, (11) Implicit Termination, (12) Multiple Instances without Synchronization,
(13) Multiple Instances with A Priori Design-Time Knowledge, (14) Multiple Instances
with A Priori Run-Time Knowledge, (15) Multiple Instances without A Priori Run-Time
Knowledge, (16) Deferred Choice, (17) Interleaved Parallel Routing, (18) Milestone,
(19) Cancel Activity, and (20) Cancel Case.

Pattern 8 starts the successor for each incoming activation. Pattern 9 starts the
successor on the first arrival, then absorbs remaining arrivals until all are accounted
for and the discriminator can reset. Filtering for a *valid* first result, a quorum,
or cancellation is an additional engine contract, not part of the original Pattern 9.
Patterns 12–15 differ by synchronization and when the number of instances is known.

Use a trace containing activation, branch identity, completion, late-arrival, and reset
events. The taxonomy concerns control flow, not resource allocation, data flow,
transactions, exceptions, or effect certainty. Primary source: [paper PDF](https://cliplab.org/Projects/S-CUBE/papers/aalst03%3Aworkflow_patterns.pdf).

## Hand-check examples for all twenty patterns

The following small examples are constructed teaching fixtures. Read the paper for its
formal context; these local observations are not conformance proofs for any engine.

| Pattern | Constructed minimal observation |
|---|---|
| 1 Sequence | A completes before B is enabled. |
| 2 Parallel Split | Completion of A enables both B and C. |
| 3 Synchronization | With B and C active, B alone cannot enable D; both can. |
| 4 Exclusive Choice | Predicate chooses exactly one of B or C. |
| 5 Simple Merge | The sole selected predecessor enables D without waiting for the other. |
| 6 Multiple Choice | Input selects B and C but not E; activate exactly that subset. |
| 7 Synchronizing Merge | In this structured fixture, wait for selected B and C, not inactive E. |
| 8 Multi-Merge | B then C arriving produces two activations of D. |
| 9 Discriminator | B then C arriving produces one activation of D; reset after both arrivals. |
| 10 Arbitrary Cycles | Trace may revisit an activity through a back edge; test entry and exit paths. |
| 11 Implicit Termination | Case ends when no activity remains active or able to be activated. |
| 12 Multiple Instances without Synchronization | Spawn three instances with independent completion; no final join required. |
| 13 Multiple Instances with A Priori Design-Time Knowledge | Model declares three instances and a barrier after all three. |
| 14 Multiple Instances with A Priori Run-Time Knowledge | Input declares five instances before they start; completion waits for all five. |
| 15 Multiple Instances without A Priori Run-Time Knowledge | Create extra instances while others run; distinguish adding from declaring no more instances. |
| 16 Deferred Choice | Competing external events enable one alternative and withdraw the others. |
| 17 Interleaved Parallel Routing | A and B must both run, order unspecified, with no overlap. |
| 18 Milestone | Permit B only while a specified state holds; test before, during and after. |
| 19 Cancel Activity | Withdraw the named activity in the case; separately inspect any external effect. |
| 20 Cancel Case | End the case's control-flow activities; separately reconcile external obligations. |

For 7, the activated-set worksheet assumes a structured split/merge pair and no hidden
incoming activation. More general topologies need a formal enabling rule. For 15, a
runtime counter alone is insufficient unless the contract says when more instances can
no longer be created. Do not confuse multiple instances of one activity with several
different branches. These examples make different facts observable, even if an engine
implements several patterns using the same primitive.

## Selection worksheet

Write five answers before naming a pattern: which activities are enabled; who chooses
that set; which arrivals trigger a successor; what makes the case terminal; and what
happens to late/duplicate observations. Then add separate resource, data and effect
contracts. An all-of join and a resource reservation answer different questions. A
finite DAG does not alone prove termination: an individual activity can diverge, wait
forever or repeatedly retry outside the drawn graph.
