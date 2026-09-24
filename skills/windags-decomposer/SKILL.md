---
license: BSL-1.1
name: windags-decomposer
description: >-
  First-party three-pass planning protocol that converts a ProblemUnderstanding into a
  revisioned decomposition proposal: typed nodes, reasoned edges, uncertainty records,
  candidate skills, and topological waves. A DAG is not an execution proof; confidence
  values are not probabilities without calibration. NOT for execution, runtime admission, or formal HTN proofs.
metadata:
  category: Agent & Orchestration
  tags: [windags, decomposer, three-pass, decomposition]
---

# WinDAGs Decomposer

## Status and input contract

This is a first-party planning protocol. It receives a `ProblemUnderstanding` and proposes a `DecompositionResult`; it does not execute the result, guarantee a skill match, or establish that nodes can run concurrently. It retains the inherited three-pass shape while replacing uncalibrated confidence bands, arbitrary node/depth limits, and “resolve Node 3” shorthand with reviewable records.

Minimum input: outcome, constraints, authority/irreversibility boundary, known evidence, unknowns, and intended acceptance evidence. If these are absent, return an abstention/evidence request rather than a fabricated decomposition.

## Three-pass procedure

### Pass 1 — extract work and uncertainty

List candidate deliverables, decisions, evidence tasks, and human gates. For each node, record input contract, output contract, unknowns, commitment (`committed`, `tentative`, or `exploratory`), and failure/unknown-effect handling.

A vague node must name what will resolve it. `resolve Node3` is invalid because it has no input, output, or edge. Replace it, for example, with `inspect-refactoring-areas`: input `current-service-analysis`; output `area-inventory`; consumers `constructor-change` and `interface-change` in the worked revision below.

### Pass 2 — nominate skills with evidence

Use known skill metadata and domain treatment as candidates, then check required outputs against the node contract. Do not keyword-route an unstructured request, promise deterministic matching, or claim zero model calls without a versioned implementation receipt. A candidate skill is not a completion proof.

For a mismatch, record the missing output and choose one: refine the node, split it, request evidence, or leave it unassigned. A qualitative confidence label must name its basis; it is not a probability without calibration and a held-out evaluation procedure.

### Pass 3 — build and check the proposal graph

Add typed edges with concrete reasons:

- `data`: versioned producer output is consumed.
- `decision`: a decision record constrains the consumer.
- `evidence`: consumer requires a receipt or finding.
- `authority`: a human/policy gate is needed before an irreversible action.

Run structural checks: ID uniqueness, endpoint existence, output-to-edge correspondence, acyclicity, and topological layers. A layer is only a graph fact. Before admission to real work, independently check effects, resources, authority, semantic coupling, missing results, and cancellation/unknown-effect states.

## Typed-edge hand check

Let A=`inspect-current-auth` and B=`read-threat-model` be read-only evidence nodes. C=`choose-auth-policy` depends on A and B; D=`implement` depends on C; E=`test` depends on D. The valid topological layers are `{A,B}`, `{C}`, `{D}`, `{E}`. If B actually consumes A’s endpoint list, add `A -> B`; valid layers become `{A}`, `{B}`, `{C}`, `{D}`, `{E}`.

This proves edge/layer consistency only. It does not prove that A/B are read-only, that their results are correct, or that a scheduler may start both.

## Worked refactoring revision

Input: “Refactor UserService using dependency injection.”

| ID | Kind / commitment | Output | Typed dependencies |
|---|---|---|---|
| `analyze-service` | evidence / committed | current-service analysis | — |
| `design-di` | decision / tentative | DI decision record | `analyze-service` (evidence) |
| `inspect-refactoring-areas` | evidence / tentative | area inventory | `analyze-service` (evidence) |
| `constructor-change` | concrete / tentative | constructor patch | `design-di` (decision), `inspect-refactoring-areas` (evidence) |
| `interface-change` | concrete / tentative | interface patch | `design-di` (decision), `inspect-refactoring-areas` (evidence) |
| `test-di` | evidence / tentative | test receipt tied to patch digests | both patches (data) |

The former “resolve Node 3” now has a contract. Whether constructor and interface changes can be admitted together requires separate file/effect/API review; their common predecessors do not decide it.

## Diagnostics

| Finding | Required repair |
|---|---|
| Missing input or acceptance evidence | Abstain or add an evidence node; do not assign COMMITTED by default. |
| Unresolved skill mismatch | Split/refine the node or keep it unassigned with a stated follow-up. |
| Edge endpoint/output missing | Reject the proposal before wave calculation. |
| Cycle | State the circular information need and add an earlier decision/evidence boundary. |
| Conflict between graph layer and resource/effect policy | Keep the layer as graph information; hold affected work until admission checks pass. |
| Prior plan assumption changes | Create a new graph revision with supersession rationale; do not silently mutate completion history. |

## References, examples, and diagrams

- [Protocol scope and confidence limits](references/protocol-scope.md)
- [Typed-edge fixture](examples/typed-edge-fixture.md)
- [Three-pass procedure](diagrams/01-three-pass-procedure.md)
- [Graph layer versus work admission](diagrams/02-graph-layer-and-admission.md)

## NOT-FOR boundaries

Do not treat this skill as problem sensemaking, runtime orchestration, an HTN implementation, a live DAG mutation tool, or evidence that a planned node succeeded.
