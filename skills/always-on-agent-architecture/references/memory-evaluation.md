# Memory evaluation and failure localization

Sources below were accessed on 2026-09-24. Their benchmark observations concern their specified datasets and model revisions; this skill revision has not reproduced those experiments.

## Primary-source contributions

- [Packer et al., MemGPT, v2 (2024-02-12)](https://arxiv.org/html/2310.08560v2): inspected §2 and §3.1–3.2. The design separates prompt-resident context from external recall/archive stores, with explicit paging calls, bounded retrieval responses and event-driven control flow. Its chat/document experiments motivate testing memory management with a fixed base model and task; they do not establish persistence, authorization, deletion, or modern model performance. Treat the paper's pressure thresholds as experimental settings, not defaults.
- [Wu et al., LongMemEval, v2 (2025-03-04)](https://arxiv.org/html/2410.10813v2): inspected §3.1–3.3 and §4 design-control descriptions. Its 500-question suite covers extraction, cross-session and temporal reasoning, updates, and abstention. It distinguishes indexing, retrieval and reading, and supplies answer-evidence locations for retrieval metrics. This suggests localizing a wrong answer before changing memory capacity. Its generated/human-edited histories and evaluator protocol do not establish performance on an operator's natural history.
- [Maharana et al., LoCoMo, v1 (2024-02-27)](https://arxiv.org/html/2402.17753v1): inspected §3–5. Dialogues are produced from personas and temporal event graphs, then human-reviewed. Evaluation includes question answering, event summaries and multimodal continuation, with evidence locations and task-specific metrics. This supports testing narrative and temporal behavior separately from isolated-fact recall. Synthetic origins and annotation choices limit transfer to deployment; no current product ranking is inferred.

## Constructed local evaluation protocol

The following is a proposed engineering extension, not a published result or a reproduction of those suites.

1. Freeze the authorized corpus snapshot, source versions, storage policy, embedding profile/space, retrieval configuration, model, prompts, budgets and oracle. Split development cases from held-out evaluation before choosing thresholds. Keep unrelated user histories separate.
2. Include paired traces: an early fact followed by a correction; the same fact at two different valid times; an unanswerable question; a needed detail lost by summarization; an explicit deletion; and an interrupted write followed by restart. Use known fixture evidence IDs so retrieval can be scored independently of prose quality.
3. For each wrong answer, determine whether permitted evidence was retained, indexed under the expected snapshot, retrieved, supplied within context, and read correctly. An unavailable index is an infrastructure outcome, not a hallucination label. Missing authorized evidence can justify abstention.
4. Compare at fixed task and budget: permitted full-history baseline where feasible, summary-only memory, and retrieval-backed memory. Keep the same base model and authority envelope. Attribute errors to individual traces; report paired changes with uncertainty and denominators, including system failures.
5. Measure answer correctness, evidence coverage, unsupported statements, update fidelity, abstention behavior, latency, storage and cost. Test recovery, deletion propagation and policy enforcement separately: a correct remembered answer can still reveal a deleted or unauthorized fact.

| Fixture | Expected observation | Failure to distinguish |
| --- | --- | --- |
| Preference corrected | Current answer uses new value with dated lineage | Overwrite of valid historical answers |
| Time-qualified question | Answer follows evidence valid at that time | Latest value substituted for history |
| Evidence never supplied | Calibrated abstention or clarification | Confident fabrication |
| Detail omitted from summary | Source-backed recovery if retention permits | Assuming compression is lossless |
| Accepted deletion | Read-back verifies required copies inaccessible | A tombstone while payload survives in an index |
| Interrupted durable write | Reconcile committed version and retry safety | Duplicate effects or fabricated completion |

A useful Book extension would join this error-localization trace to the existing provenance-bound memory proposal. It is a candidate worked example, not a claim of novel memory architecture.
