---
name: pilot-hypertree-execution
description: >-
  First-party planning doctrine for recording context clusters, hard artifact dependencies,
  order preferences, admission conditions, and a declared wave cap. NOT for HTP results
  or claims that file disjointness, parallelism, or human capacity are established theorems.
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Agent & Orchestration
  tags: [planning-doctrine, context-clusters, hard-dependencies, order-preferences, waves]
  provenance: {kind: first-party, owners: [port-daddy], dated: 2026-08-22}
---

# Pilot Hypertree Execution

## Deliverable

Produce a Markdown cluster plan with typed edges, declared admission conditions, a chosen policy cap, and the evidence a dependent cluster needs before it becomes ready. This is a planning deliverable; it neither dispatches work nor authorizes an external effect.

## Status and boundary

This is a first-party doctrine dated 2026-08-22 and documented in [CHANGELOG.md](CHANGELOG.md). It borrows “outline” language as a planning metaphor; it is not Gui et al.’s HTP algorithm, an HTN semantics, or database hypertree decomposition. The 6–7 range is a local review/digest policy, not a measured capacity finding.

A **hard** edge identifies a required artifact or data dependency. An **order** edge identifies a merge/review preference. Only a satisfied hard edge establishes the relevant dependency condition; neither edge type proves resources, authorization, effects, or task completion.

## Planning procedure

### 1. Produce a cluster outline

State the objective, candidate context clusters, file/subsystem scopes, and every cross-cluster edge. File overlap is one collision signal. It is not proof of semantic independence: contracts, APIs, budgets, credentials, and tests can cross otherwise disjoint paths.

For each edge, choose exactly one type:

- `hard`: consumer requires a particular versioned upstream artifact to begin.
- `order`: work may begin in either order, but a preferred landing/review order reduces known churn.

If an edge is unclear, keep it unresolved for review; do not silently treat a preference as an enforced dependency or vice versa.

### 2. Check causal closure and admission

A same-file producer/consumer chain normally remains within one cluster or becomes an explicit hard cross-cluster edge. For every proposed admitted cluster, check:

1. Required hard-producer artifacts are accepted and identified.
2. The cluster’s file scope and semantic interfaces have been reviewed against running work.
3. Required authority, resources, budget, and acceptance criteria are declared.
4. The plan states how cancellation, rejected output, and an unknown prior effect are recorded.

Passing these checks admits a work item for consideration. It does not mark the work completed or authorize an external effect.

### 3. Choose and apply a policy cap

Declare one cap for the current wave. Under cap 6, five unblocked clusters fit and a sixth reaches the cap; a seventh exceeds it and queues. Under cap 7, a seventh reaches the cap and an eighth exceeds it. The range 6–7 does not itself choose a cap.

Use [02-pilot-wave-policy.md](diagrams/02-pilot-wave-policy.md) to record this count. Reassess when an accepted completion, a rejected result, an unknown effect, or a policy change changes readiness.

### 4. Integrate and close only with evidence

For every completed item, retain its output identity, acceptance result, and any unresolved effect. Dependent clusters become eligible only after their specific hard artifacts satisfy the declared contract. Order edges can guide review order but do not block a ready item.

## Worked 2026-08-22 fixture

The doctrine’s recorded fixture has five clusters: identity, cli-tube, receipts, website, and roadmap-merge. With a declared cap of 6, the arithmetic is `K=5<=6`; capacity does not hold any of those five back. This checks only the count.

`endpoint-core -> static-cleanup` is a same-file hard chain: cleanup consumes the preceding artifact and must be sequenced or explicitly versioned. `roadmap-merge` was described as an order preference for merge hygiene; it may be prioritized without becoming a start-blocking hard producer. The fixture records doctrine history; it does not empirically validate the cap or prove file scopes were semantically independent.

## Evidence checklist

- [ ] Cluster scope names files **and** relevant semantic/API invariants.
- [ ] Each cross-cluster edge is `hard`, `order`, or explicitly unresolved.
- [ ] Every hard consumer names the accepted producer artifact/version.
- [ ] The current numerical cap is stated and arithmetic checked.
- [ ] Admission records resources, authority, completion criterion, cancellation, and unknown-effect handling.
- [ ] Integration retains acceptance evidence; no intent or dispatch is reported as success.

## Diagrams and reference

- [Edge semantics](diagrams/01-pilot-edge-semantics.md)
- [Cap and wave policy](diagrams/02-pilot-wave-policy.md)
- [Doctrine scope](references/pilot-doctrine-scope.md)

## Common mistakes

- Equating file disjointness with semantic independence.
- Calling an order preference a readiness block.
- Treating the policy range 6–7 as one numeric cap.
- Marking a dispatch or intent as completed work.
- Treating an HTP outline as a scheduler or authorization mechanism.
