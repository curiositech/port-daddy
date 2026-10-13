# AgentBench, AutoGen, and MetaGPT: context with bounded transfer

AgentBench and AutoGen inform agent environments and collaboration frameworks. They are not duplicate-task benchmarks, so their traces do not establish overlap rates, collision thresholds, or an intervention rule.

## Useful trace fields and hypotheses

Preserve task/environment version, agent/task IDs, scope label, declared plan and acceptance facts, tool invocation name and normalized authorized argument signature, result status, shared-state revision, termination reason, and executable success oracle where one exists.

| Telemetry observation | Competing explanation to preserve |
| --- | --- |
| Matching tool arguments | retry, polling, cache miss, or duplicate effort |
| Same resource but disjoint symbols/outputs | legitimate parallel work |
| Same start time | benign fan-out |
| No observed write after read | partial instrumentation or read-only work |
| Brief lacks latest version | stale brief needing reconciliation |

None is an overlap verdict. Preserve provenance and adjudicate against task records and integration outcomes.

## Structured communication is not detection

MetaGPT’s [communication protocol](https://arxiv.org/html/2308.00352v7) §3.2 describes structured interfaces, a global message pool, subscriptions based on role interests, and action activation after prerequisites. Any agent can retrieve required information from the pool. This can inform task-record transport, but it does not offer a semantic duplicate-task detector. Do not infer undocumented watcher keys, hashes, or routing restrictions.

Evaluate independently labeled pairs: candidate generation by recall, later adjudication by precision, disagreement, and unknown coverage. Evaluate all eligible pairs where feasible or disclose a labeled sampling frame; split connected pairs/task families together to prevent leakage.

**Sources read.** [AgentBench](https://arxiv.org/abs/2308.03688), abstract/metadata, and MetaGPT §3.2 (accessed 2026-09-24). No quantitative transfer is made.
