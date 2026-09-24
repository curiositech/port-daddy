# Worked scheduling fixtures

All durations and dates are constructed. They make schedule feasibility and policy branches inspectable; they do not record a provider run.

## Eight-task release plan: complete accounting

| ID | Duration | Predecessors | Resource | Start | End | Slot/gate | Output evidence |
| --- | ---: | --- | --- | ---: | ---: | --- | --- |
| A | 2 | — | compute | 0 | 2 | slot 1 | source bundle and provenance |
| B | 3 | A | compute | 2 | 5 | slot 1 | analysis bound to A |
| C | 2 | A | compute | 2 | 4 | slot 2 | policy review artifact bound to A |
| D | 1 | B, C | compute | 5 | 6 | slot 1 | release draft bound to B/C |
| E | 2 | D | compute | 6 | 8 | slot 1 | security receipt bound to D digest |
| G | 1 | C, E | human | 8 | 9 | human gate | approval bound to C/E and D digest |
| F | 1 | G | compute + authority | 9 | 10 | slot 1 | publish exactly approved D digest |
| V | 1 | F | compute | 10 | 11 | slot 1 | readback verification |

Every predecessor ends no later than its consumer starts. Compute intervals overlap only for B `[2,5)` and C `[2,4)` on separate slots. The chain A-B-D-E-G-F-V is `2+3+1+2+1+1+1=11`; the plan’s makespan is 11. G is a constructed human delay and does not consume a compute slot. The planned gate interval assumes a real approval arrives and binds D; F remains blocked without that approval and current action authority. Elapsed time is not approval.

## Corrected research-pipeline fixture from the original example

The original named seven tasks while calling the graph eight-task, omitted the gather duration, and asserted a critical path without enough edge/duration data. This preserves its named workflow as a fully accounted **seven-task** fixture rather than inventing an eighth task. Capacity is three identical non-preemptive compute slots; the constructed deadline is 60 seconds.

| ID | Original-style task | Duration | Predecessors | Planned interval | Slot |
| --- | --- | ---: | --- | --- | --- |
| G | gather sources | 5 s | — | [0,5) | 1 |
| V | validate sources | 15 s | G | [5,20) | 1 |
| M | extract metadata | 20 s | G | [5,25) | 2 |
| F | fetch citations | 25 s | G | [5,30) | 3 |
| A | analyze content | 20 s | V, M | [25,45) | 1 |
| C | cross-reference | 20 s | V, F | [30,50) | 2 |
| S | synthesize report | 10 s | A, C | [50,60) | 1 |

At tick 5, V/M/F are all ready and use the three slots. A waits for V/M; C waits for V/F; S waits for both A/C. The chain `G-F-C-S` is `5+25+20+10=60`, so the resulting makespan meets the constructed 60-second deadline exactly, without the original’s unsupported 55-second calculation. An alphabetical selection happens to be irrelevant at tick 5 because all three fit, and no “longest task is not critical” claim is needed.

## Uneven-duration barrier hand check

Two compatible slots, no resource contention: B duration 3 and C duration 1 are both ready at tick 0; D duration 1 depends only on C.

| Policy | B | C | D | Makespan |
| --- | --- | --- | --- | ---: |
| Work-conserving ready queue | `[0,3)` | `[0,1)` | `[1,2)` | 3 |
| Fixed-level barrier | `[0,3)` | `[0,1)` | `[3,4)` | 4 |

The ready queue releases D when C has accepted completion; it does not wait for unrelated B. The barrier adds one tick in this fixture. If a policy requires a batch-level review after both B and C, the barrier is intentional and the earlier D start is invalid.

## Calendar and unknown-effect hand check

`review@r1` is ready on day 4 and needs one human reviewer for one day. The sole compatible reviewer is unavailable on days 4–5, so the resource calendar rejects `[4,5)` and `[5,6)` and admits `[6,7)`. A compute slot being free does not make `review@r1` admissible.

`publish@op-77` dispatches only after accepted review, approval evidence, and action authority. Its request digest `req-3` times out after possible transmission. Set outcome to `unknown`; neither `done()` nor release of an ordinary success-dependent verification task is legal. A separately authorized reconciliation/readback probe can run while that dependent remains blocked. Unknown termination also leaves resource occupancy unresolved; do not recycle an exclusive reservation until its policy establishes safe release. Provider/readback success yields a receipt; documented definite absence plus a safe retry contract permits retry using `op-77`; an ambiguous response remains on authorized-resolution hold. Reverting a schedule does not compensate a provider effect.
