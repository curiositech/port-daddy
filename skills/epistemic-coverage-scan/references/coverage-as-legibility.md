# Coverage as Legibility: Epistemic Scan as the Operator's Guarantee

The Port Daddy "Legible Swarm" paper (`docs/research/north-star/legibility-leviathan.md`,
pd-adr-048 L2) argues that a swarm's Leviathan governs only as well as it can **see**
the swarm — and that illegibility is itself a state-of-nature failure mode wearing a
crown. Epistemic coverage scan is the SOMA-side answer to the same problem: an
innate mechanism that guarantees the operator (and the coordinating authority) can
never be lied to by a gap in the traversal record.

## The Core Structural Problem

EFE-driven agents follow pheromone gradients. Gradients only form where agents have
been. A node that has never been visited accumulates no PREFERENCE traces, no
RESOLUTION damping, no ANTIBODY signatures — it is **structurally invisible** to
gradient-following agents. On a code review graph, this is not a performance issue;
it is a correctness failure: `utils/crypto.py` was the canonical SOMA example where
EFE alone achieved 50% trial completion because the isolated node was never reached
by gradient climbing. The operator inspecting the pheromone map would see activity
everywhere except the one file that held the real vulnerability.

This is exactly Scott's **Potemkin digest** failure at the infrastructure layer: the
map (pheromone field) looks thorough because it is dense where agents converged, but
the map is not the territory. James C. Scott's Normalbaum warning — *"the legible
monoculture erases the ecological mētis the forester depended on"* — maps precisely:
gradient convergence erases the topological mētis that made isolated nodes matter.

## Epistemic Scan as Legibility Infrastructure

Epistemic scan does not improve coverage by making agents smarter; it enforces a
**coverage invariant** that the operator can reason about externally:

> After `total_steps > 3`, for any well-formed graph with `n` nodes and any
> non-zero agent population, the probability that a given node has never been
> visited goes to zero at rate ≈ `(1 - p_scan)^k` per agent-step, where
> `p_scan = |unseen| / n` and `k` is the number of elapsed steps. The self-annealing
> means the mechanism is most aggressive when coverage is worst (p_scan → 1.0 at
> initialization) and quiescent when coverage is saturated (p_scan → 0.0).

This gives the operator a **verifiable legibility guarantee**, not a statistical
hope: if the scan fires and the visit_counts dict is durable, no node can remain
permanently invisible. That is the Legible Swarm paper's demand applied at the
traversal layer.

In Port Daddy terms, this is the difference between:
- **Attention Queue** coverage: the operator sees what agents *reported* (can be
  unfaithful, per Turpin et al. 2023 [#7] in the paper — an agent's narration is
  secondary evidence, not a verifiable artifact).
- **visit_counts coverage**: the operator can audit `medium.snapshot()["visit_counts"]`
  and confirm by structural inspection that every node was touched, independent of
  any agent self-report.

`visit_counts` is the **verifiable zoom target** (legibility-leviathan.md §4.2):
an operator-owned artifact the daemon/Medium tracks, not a model's summary of what
it thinks it did.

## The Digest-with-Zoom Mapping

The Legible Swarm paper's one law is *"every summary is a lens onto the real
artifact, never a replacement for it."* In an ant-colony traversal system, the
pheromone summary has two failure modes:

1. **Mētis erasure**: isolated nodes (low-degree, no gradient neighbor) vanish from
   the pheromone summary. Epistemic scan corrects this by forcibly touching them.
2. **Unfaithful narration**: an agent that teleported to a node and did no real work
   (cache hit, API timeout) still increments `visit_counts`. For code review this
   means the *work function*, not just the scan, must produce a verifiable artifact
   (a finding record, an ANTIBODY trace, a RESOLUTION deposit). The scan guarantees
   traversal; it does not guarantee quality of work. The operator must still zoom to
   the work artifact, not trust the visit count alone.

This is the boundary of what epistemic scan owns: **topological completeness** (every
node is reached) versus **work quality** (the work done at each node is faithful).
A coverage audit answers the first question. An honest attestation (`lib/attest.ts`
in Port Daddy, or `medium.snapshot()["findings"]` in SOMA) answers the second.

## Concrete Numbers from SOMA Benchmarks (Week 2, 20 trials, seed=42)

| Metric | Week 1 EFE only | Week 2 + Epistemic Scan |
|---|---|---|
| Completion rate | 50% | 100% |
| Isolated node visits (`utils/crypto.py`) | ~30% of trials | 100% of trials |
| Mean steps to completion | 11.6 | 9.5 |

The 50% failure rate in Week 1 is **not a statistical artifact**; it is the
structural invariant that gradient-only traversal cannot guarantee. The 100%
completion rate in Week 2 is guaranteed by the scan invariant, not by luck.

## Operational Connection to Port Daddy's Coordination Layer

Port Daddy's **claims** (`docs/adr/pd-adr-038-claim-tree.md`) are advisory
announcements of intent. A claim on a file does not prove the file was read. In a
system without epistemic scan, an agent can claim every file in a repo and produce
no finding on isolated nodes — and the claim log looks complete.

The correct analogue in a Port Daddy + SOMA hybrid would be: claims are the
*administrative* legibility layer (Scott's safe-to-flatten structured fields); the
`visit_counts` + findings log is the *mētis* legibility layer (never paraphrase,
always preserve verbatim). Epistemic scan ensures the mētis layer is populated for
every node, making the claims layer honest rather than performative.

## Key Points

- Gradient-following agents (EFE or epsilon-greedy) produce **structurally incomplete
  traversals** on any graph with isolated or low-degree nodes; epistemic scan is
  the only mechanism that provides a coverage invariant rather than a coverage hope.
- `visit_counts` in `GenerativeModel` is the **operator-verifiable artifact** for
  coverage — independent of agent self-report, analogous to Port Daddy's daemon
  SQLite state rather than an agent's narration of what it did.
- Epistemic scan owns **topological completeness**, not **work quality**; auditing
  coverage and auditing finding faithfulness are two separate checks that must both
  be run.
- The self-annealing probability (`p_scan = |unseen| / n`) means the mechanism costs
  near-zero overhead once coverage saturates — it is not a constant tax.
- "Coverage as legibility" fails if the work function is a stub; scan + honest work
  function together form the SOMA equivalent of Port Daddy's verifiable-zoom rule.

## See Also

- `references/innate-vs-adaptive.md` — priority ordering of scan vs. EFE teleport
  vs. EFE softmax; where scan sits in the `_select_action()` stack.
- `references/scan-mechanism.md` — detailed mechanics of the self-annealing
  probability, warm-up gate, and target selection within the unseen set.
- `docs/research/north-star/legibility-leviathan.md` in the port-daddy repo —
  the full Legible Swarm paper; §4 (digest-with-zoom), §4.2 (verifiable zoom
  targets), §8 (Potemkin digest failure mode) are the primary connection points.
