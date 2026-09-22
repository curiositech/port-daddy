# Skill audit — `agent-context-partitioner`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

The skill is **not production-ready** and should be supplanted as a bundle,
while preserving only corrected, independently tested pieces. Overall semantic
score: **3.3/10**. It contains useful context-partitioning vocabulary and a good
prose warning about embedding-space identity, but its executable algorithms
violate advertised invariants, its authority and trust boundaries are absent,
several pseudocode paths are mechanically wrong, literature claims are
misattributed, and all thirteen support files are unreachable from `SKILL.md`.

| Dimension | Score / 10 | Finding |
|---|---:|---|
| Frontmatter | 6 | Specific description and exclusions, but ignored `io-contract`, broad tools, and overlapping scope. |
| Progressive disclosure | 2 | 746 physical lines; all thirteen support files are orphaned. |
| Anti-patterns | 2 | One order-dependence trap; no systematic novice/expert/detection catalogue. |
| Visual artifacts | 1 | Zero Mermaid diagrams for several authority and lifecycle flows. |
| Shibboleths | 4 | Correct embedding-space prose is not enforced by its executable data model. |
| Self-containment | 3 | Demos exit zero while expected fixture output and key invariants fail. |
| Activation | 5 | Broad wording overlaps planning, orchestration, economics, and spawn authority. |

## P0 findings

### P0-1 — Optimization precedes authority and trust

Token pressure can directly produce spawn/handoff actions without birth grant,
capability scope, spend authority, tenant/disclosure filtering, or trusted
delegator. The skill must emit a proposal only. Authorization, capacity, and
runtime launch belong to separate authorities.

### P0-2 — Trust-channel poisoning is enabled

The handoff template tells successors to obey or preload free-form content while
the memory schema has no provenance, trust tier, signature, evidence binding,
or control/evidence separation. Signed control directives, verified evidence,
attributed claims, and untrusted observations need distinct channels.

### P0-3 — Embedding identity is stated but unenforced

`ContextChunk` omits `spaceId` and compares arbitrary vectors. A required
embedding envelope must bind model/config digests, preprocessing, pooling,
dimensions, normalization, metric, precision, quantization, and redaction. A
mismatch fails closed or triggers separately receipted re-embedding.

### P0-4 — Causal closure, budget, and partitioning are unsound

The merge-or-share algorithm implements only merge. Over-budget dependencies
remain split without typed edge, authorized copy, or infeasible result. The DAG
partitioner ignores edge-specific cost, admits oversized nodes, and iterates an
unordered set, producing hash-seed-dependent plans.

### P0-5 — Pseudocode is mechanically wrong

Examples include a key-shape mismatch that raises `KeyError`, a global confidence
value presented as per-chunk confidence, BIC over one observation with an
incompatible penalty, double-counted communication cost, and a later phase that
overwrites a cycle-repaired partition. Sketches must not be labeled algorithms.

### P0-6 — Unsupported theory and phantom integration

The asserted lower bound `Communication >= Omega(I(C_A; C_B | q))` and the
cosine-to-information-complexity inference are not established by Yao 1979.
HyperTree Planning and DyLAN are also mischaracterized. Claimed Port Daddy
routes/events/commands are absent at this source anchor.

### P0-7 — No executable evaluation

There is no test directory, runner, calibrated corpus, hard-invariant validator,
or baseline comparison. The only expected-output fixture does not match the
algorithm's output.

## Executed red-team probes

| Probe | Expected invariant | Observed failure |
|---|---|---|
| Example DAG | 4 agents / 4 handoffs | 7 agents / 8 handoffs |
| Hash seeds 1–5 | Canonical result | 5 or 6 agents, different chains and costs |
| Edge weight 1 vs 999999 | Objective or plan changes | Identical total cost |
| Oversize singleton | Infeasible | 110-token run admitted to 70-token budget |
| Causal dependency | Shared artifact, typed edge, or infeasible | Silent split |
| Embedding space | Reject absent/mismatch | No `spaceId` field |
| Online capacity | No load over 10 | One load reached 16 |
| Input permutation | Stable canonical partition | Different co-clustered pairs |
| Pressure fixture | Policy and trace agree | Three boundary labels disagree |

All three Python demos exited zero. That is the false-green finding: process
success does not imply contract satisfaction.

## Claims to delete or narrow

- Delete “order-independent by construction.”
- Delete semantic-truth and per-assignment “stability certificate” claims from
  H0 persistence.
- Rename the flat centroid heuristic; it is not BIRCH.
- Delete minimum-cost/batch-optimal claims for the heuristic DAG partitioner.
- Narrow “gold standard” language for the Gap Statistic.
- Delete the shown BIC and MDL spawn formulas until a coherent likelihood/code-
  length model and evaluation exist.
- Delete “similarity above 0.5 means the receiver can infer the rest.”
- Delete the Yao/mutual-information/cosine theorem chain.
- Mark all numeric thresholds as uncalibrated examples, not defaults.
- Correct the EAC DOI and the HyperTree/DyLAN source summaries.

## Replacement boundary

The skill should create **partition proposals over already authorized candidate
bodies**. It should not build the DAG, execute a runtime, forecast all context
economics, authorize births, or grant tools/effects.

Order of work:

1. validate provenance, trust, disclosure, capability, and authority envelopes;
2. build hard causal/dependency and information-flow constraints;
3. check feasibility, capacities, and quotient-DAG acyclicity;
4. create candidate partitions and `K` proposals;
5. optimize coherence, weighted communication, and latency only inside the
   feasible set;
6. submit any `K` increase to a separate birth-authority gate;
7. emit attributable partition, handoff, limitation, and authority receipts;
8. evaluate hard invariants before soft quality metrics.

## Required bundle

- Reduce `SKILL.md` to approximately 180–220 lines with precise NOT-for cases.
- Add `CHANGELOG.md` and direct reason-to-load links to every retained file.
- Add references for authority/trust, embedding identity, causal invariants,
  online/static partitioning, birth authority, evaluation/calibration,
  anti-patterns, and a source-to-claim ledger.
- Replace free-form handoff templates with typed control and evidence envelopes.
- Add authority, handoff-trust, and partition-lifecycle Mermaid diagrams.
- Add a JSONL evaluation corpus and tests for permutation/seed determinism,
  cross-space rejection, budget overflow, causal closure, quotient cycles, edge
  sensitivity, infeasible singletons, denied birth, poisoned handoff, pressure
  boundaries, and exact small-DAG comparison.

Hard acceptance gates are zero unauthorized births, cross-space comparisons,
unauthorized copies, causal violations, budget overflows, quotient cycles,
poisoned evidence promoted to control, and fixture mismatches.

## Activation cases

Positive: bounded partition proposal for pre-authorized bodies; same-space `K`
proposal; permutation-stability audit; weighted DAG partition; quotient-cycle
audit; partition-evaluation corpus. Negative: runtime execution; spawn
authorization; context-exhaustion forecasting without partitioning; generic role
and prompt design; generic customer clustering; cross-space vector comparison;
single-agent work; tool-native agent launch.

## Update rule

Supplant the current contract. Do not preserve the broken algorithms as a
“legacy mode.” Any corrected algorithm needs an executable reference,
invariant tests, calibrated policies, and a clearly labeled heuristic objective.
