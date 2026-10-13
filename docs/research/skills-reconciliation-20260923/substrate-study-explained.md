# What the substrate study is

Checked against source and stored CSVs on 23 September 2026. The primary checkout and this worktree contain identical study material apart from Finder metadata. This is an explanation and source audit, not a new experimental result.

## The interesting question

The Book separates the authority to change shared state from the agents proposing those changes. Its single-writer rail makes one controlled commit path responsible for accepting changes, with claims used to prevent conflicts. This study asks whether that rail is actually a good collaboration model, compared with giving each agent its own worktree and integrating through a merge queue. The protocol explicitly permits an answer that demotes the rail to a confinement mechanism. That willingness to test the architectural premise is its strongest feature.

The [protocol](../../../studies/substrate-study/PROTOCOL.md) labels itself pre-registered on 7 September, before harness code and data. This review did not independently authenticate that chronology. There are two proposed experiments:

- **S2, collaboration:** a Python discrete-event simulation replays real historical patches from pinned windows of Requests, NestJS and the Rust Book. Workers are scripts with cooperative or impatient retry behavior, not language models. Git operations are real; work durations and agent behavior are modeled.
- **S1, confinement:** a proposed comparison of bare processes, containers, gVisor and Firecracker, asking which write paths a broker can actually refuse and what that costs. This directory contains no completed S1 results.

## What is compared

| Treatment | Mechanism | Question |
|---|---|---|
| U | Shared tree, whole-file last-writer replacement | What can be lost without coordination? |
| B0 / B005 / B02 | Advisory file claims; 0%, 5% or 20% modeled bypass | How does bypass affect the modeled outcomes? |
| C | File claims and enforced landing through one rail | What does the rail buy and cost? |
| CR | Rail with line-range claims | Does finer granularity reduce contention? |
| D | Separate worktrees and a rebase/merge queue | How does the standard alternative compare? |

The five registered measures are throughput, wasted lines, conflict incidents, time to land, and evidence completeness. The study also tracks a torn-tree check. Four hypotheses address confinement, rail versus queue, advisory versus enforced claims when nobody bypasses, and claim granularity.

## What actually exists

The [pilot](../../../studies/substrate-study/PILOT.md) uses only Requests, 200 tasks per cell, 2/4/8 workers, two temperaments and two seeds. Running `PYTHONDONTWRITEBYTECODE=1 python3 -m harness.pilot_summary` against the stored files reproduced **80 of 84 cells**, with no task-count inconsistencies. Four D/eight-worker cells are missing. There are 80 summary CSVs and 80 event logs. This reproduces aggregation, not the underlying runs.

The intended full design is seven treatment combinations × four worker counts × three corpora × two temperaments × twenty seeds: **3,360 cells**. It has not been completed here, and `REPORT.md`, the intended adjudicated result, is absent.

**The current pilot cannot decide whether the rail beats the merge queue.** Every completed D cell lands only 4 of 200 tasks. The [changelog](../../../studies/substrate-study/CHANGELOG.md) identifies this as a harness defect involving historical patch dependencies, out-of-order completion and rebase behavior. It explicitly warns against interpreting those figures as evidence that merge queues fail. The missing D/eight-worker cells also prevent the high-overlap, high-concurrency comparison required by H2.

B0 and C have matching stored metric values, but they share the same modeled path. That is useful implementation consistency evidence; it does not establish the cost or effectiveness of real operating-system confinement. Similarly, evidence completeness of 1 is generated from a bookkeeping flag, not an independent audit of signed durable receipts.

## Source-level issues to resolve before a larger run

These observations are grounded in the current [simulator](../../../studies/substrate-study/harness/sim.py), [worker policy](../../../studies/substrate-study/harness/agents.py), [substrates](../../../studies/substrate-study/harness/substrates.py), and [metrics](../../../studies/substrate-study/harness/metrics.py). Their practical magnitude needs focused fixtures before interpreting new data.

1. **Use a treatment-neutral content oracle.** The safety check looks for conflict markers, while U/B bypass loss is counted whenever a previously written file is overwritten. A newer historical postimage may retain the earlier edit. Neither rule independently establishes retained task effects across all treatments.
2. **Repair and validate D's task dependencies.** Verify a task's actual contribution after landing, including no-op rebases and reordered dependent commits. Repair the baseline before comparing it.
3. **Separate worked effort from unstarted rejection.** Abandonment currently charges the task's full line count even when the initial claim was refused before work began.
4. **Use matched exogenous randomness.** One RNG supplies bypass decisions and work durations; treatment-specific draws and retries change later durations. A shared seed is not necessarily a shared per-task workload.
5. **Measure waiting and retries consistently.** Claim-based cooperative retries can restart modeled work and replace its completion timestamp; D retries landing. Retry caps also differ (200 versus 3). Report end-to-end latency and policy sensitivity separately.
6. **Audit filtered corpus reconstruction.** Bridging diffs incorporate dropped commits into later retained tasks; revalidate binary and size exclusions on the effective patches as well as historical commits.

The sensible next experiment is a small correctness suite with known independent and dependent edits, followed by a repaired, versioned pilot and sensitivity analysis. Only then should the full grid and an LLM-agent replication be run. This task has preserved the protocol and result files; it has not silently repaired the harness or retroactively changed the experiment.
