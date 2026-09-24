---
name: runtime-task-overlap-detector
version: 0.1.0
description: >
  Designs a privacy-authorized, advisory task-overlap signal from current,
  versioned task records. Retrieval and NLI features select pairs for independent
  review; neither proves duplicate work nor authorizes an effect.
author: soma-windags-graft
tags: [multi-agent, deduplication, semantic-similarity, embeddings, nli, streaming, coordination]
pairs-with: []
---

# Runtime Task Overlap Detector

## When to Use

- A coordinator needs a review queue for concurrently declared work whose outputs or acceptance conditions may collide.
- A system can expose only authorized, current task-record fields and wants to evaluate candidate recall before any operational policy.
- A telemetry stream may reveal duplicate effort, retries, stale briefs, or legitimate independent review and must retain that ambiguity.

NOT for exact task identity by string equality, MinHash, ROUGE, cosine, or a hash alone. Exact equality applies only to the same normalized representation; MinHash estimates set resemblance and SimHash fingerprints a different representation. Neither settles task identity. Do not use this skill to cancel, kill, merge, reassign, or transfer work.

## Comparison contract

Task identity is an adjudicated relation over **objective, required deliverable, acceptance conditions, authorized scope, work version, and purpose**. An owner identifies a responsible principal; it is evidence for coordination but is not identity. Different owners can attempt the same required deliverable. The same artifact can remain distinct work when an independent review is required, when outputs differ, or when the task version changed.

Keep a record with an immutable `taskId`, `workVersion`, scope and disclosure labels, objective, deliverable, acceptance checks, declared dependencies, plan facts, and provenance. Missing authorization, freshness, or embedding-space compatibility yields `unknown`, never a negative match.

MetaGPT is useful context for structured, dependency-aware collaboration. Its paper describes a shared pool where agents can retrieve needed information, role interests that select relevant subscriptions, and actions that activate after prerequisites arrive. It does **not** validate a duplicate-task detector or imply that agents receive only messages registered to a role type. See [AgentBench, AutoGen, and MetaGPT context](references/agentbench-overlap-patterns.md).

## Shadow-mode retrieval pattern

This is a policy interface, not an implementation or a calibrated configuration. An adapter must make authorization, record freshness, compatible space identity, lexical policy, and version removal inspectable.

```text
onCurrentTask(task):
  record = authorizedCurrentRecord(task)
  if record is absent: emitUnknown(task.id, "authorization-or-freshness"); return
  pool = snapshotOfActiveRecordsWithinAuthorizedScope(record.scope)
  pool = removeOwnAndSupersededVersions(pool, record.taskId)
  compatible, omitted = partitionByExactEmbeddingSpace(pool, record.embedding)
  recordCoverageOmissions(omitted)  # never treat an omitted pair as distinct
  lexical = tryLexicalRank(record, compatible)  # result or unavailable
  dense = tryDenseRank(record, compatible)      # exact compatible space only
  if lexical.available and dense.available:
      ranked = reciprocalRankFuse(lexical.ranks, dense.ranks)
      coverage = "hybrid-with-recorded-omissions"
  else if lexical.available and policy.permitsLexicalOnly:
      ranked = lexical.ranks
      coverage = "degraded-lexical-only"
      recordRepairNeeded("dense-retrieval-unavailable")
  else: emitUnknown(task.id, "required-retriever-unavailable"); return
  for candidate in boundedCandidates(ranked):
      if not bothStillAuthorizedAndCurrent(record, candidate):
          emitUnknown(task.id, "record-or-authority-changed"); continue
      features = declaredScopeAndPlanFeatures(record, candidate)
      features.nli = optionalDirectionalNliFeatures(record, candidate)
      emitAdvisory(record.taskId, record.workVersion,
                   candidate.taskId, candidate.workVersion, coverage, features,
                   status="needs-independent-adjudication")
```

Missing embedding identity is recorded as omitted comparison coverage; it never permits comparing incompatible vectors. This conservative sketch does not attempt lexical recovery of space-incompatible records. The ranking adapters return explicit availability, use one policy/index snapshot, and do not interpret an empty successful result as a retriever outage. Retain that snapshot identity with each advisory; recheck versions again when a coordinator acts. In a Port Daddy deployment, degraded retrieval should name `pd doctor` as the repair route once local-runtime use is authorized; during a halt, retain diagnostics without starting it.

Reciprocal rank fusion combines ranked candidate lists without assuming their score scales are comparable; the original retrieval paper used it for information-retrieval rankings, not duplicate-agent labels. A constant or a retrieval depth must be selected and evaluated locally. The signal has no actuator. A coordinator may inspect evidence and a separate authorized policy may decide what happens next.

## Labels and evaluation

Use `same_task`, `partial_overlap`, `related_distinct`, and `insufficient_evidence`. Preserve rationale and disagreement. Include these constructed fixtures in a labeled corpus:

| Pair | Label rationale |
| --- | --- |
| Two owners patch the same required validation and acceptance test | possible `same_task` |
| Same file, disjoint requested outputs | `related_distinct` |
| Same change plus a mandated independent review | distinct purpose; not automatically duplicate |
| Shared prerequisite, different deliverables | `partial_overlap` |
| Same path under a new requirement version | `insufficient_evidence` until reconciled |
| Paraphrased descriptions, same required output | positive candidate for `same_task` |

Measure candidate recall separately from adjudicator precision. Split connected pairs or shared task records together across train/development/holdout so versions and paraphrases cannot leak. If policy changes after holdout inspection, that holdout is consumed. An absent candidate or an unknown record is not proof that no overlap exists. Full protocol and telemetry hypotheses are in [task-overlap evaluation](references/task-overlap-evaluation.md).

## Navigation

- [Candidate review flow](diagrams/01_flowchart_decision-points.md)
- [Scoped shadow signal](diagrams/research-r07-shadow-mode-scoped-task-overlap-signal-rewrites-existing-mermaid.md)
- [Leakage-resistant evaluation](diagrams/research-r08-threshold-calibration-without-leakage.md)
- [Embedding and rank fusion](references/embedding-similarity-approaches.md)
- [Directional NLI features](references/entailment-based-detection.md)
- [Plan representations and hashes](references/plan-sketch-hashing.md)
- [Source correction ledger](references/source-correction-ledger.md)

## Candidate Book material

The useful lesson is a boundary, not a novel theorem: task identity is an evidence-backed relation while ownership is a coordination attribute. A future Book treatment should compare this distinction with existing record/version/provenance practice and must not claim an observed reduction in duplicate work without a separately published evaluation.
