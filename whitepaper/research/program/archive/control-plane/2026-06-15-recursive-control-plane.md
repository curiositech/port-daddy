# Bold concepts: the recursive control plane (research capture)

> Status: **research / exploratory.** Not canon. A landing pad for the bolder
> cross-cutting ideas generated alongside the four-paper rewrite
> (`docs/research/north-star/00-THE-FOUR-PAPERS.md`, pending in #378), and the **graft target** <!-- cite-exempt: pending in #378 -->
> for `erichowens/soma` and `curiositech/windags` once those repos are added to
> the session scope. The "Open research items" list at the bottom is meant to be
> promoted into `docs/research/north-star/00-THE-LEDGER-open-problems.md` (research) and/or the Cartographer
> roadmap (`docs/ROADMAP.md`).

## The unifying frame: legibility is recursive

The papers treat legibility as one-directional — the **operator** must see the
swarm. But every party that must coordinate needs a legible, *suggestible* view
of everyone else doing the same kind of work. The operator suffers read-poverty
about the swarm; **each agent suffers read-poverty about its peers**; and **each
harbor suffers read-poverty about its federation**. The control plane is
**fractal**: port-daddy is the operator's control plane over agents; agents need
one over *each other*; federated harbors need one over all the daemons/operators.

This frame gives the otherwise-homeless threads a job: read-poverty,
digest-with-zoom, and tokens-as-COGS are **recursive** — they recur at every
tier, as the substance of each tier's control plane.

---

## Concept 1 — The recursive control plane (and where it breaks symmetry)

Three tiers, **self-similar in protocol**:

| Tier | Who coordinates | Enforcer | Canon home |
|---|---|---|---|
| agent ↔ agent | peers in one box | the **daemon** (sovereign arbitrates) | Paper 1 substrate + Paper 2 |
| operator → agents | port-daddy today | the **daemon / operator** | Paper 2 |
| operator ↔ operator | federated harbors | **nobody** — needs **bonds** | Paper 4 |

The key insight: the recursion is self-similar in *protocol* but **breaks
symmetry at the top tier — exactly at the folk-theorem boundary.** Inside one
box a coordination round works because the daemon is a sovereign who can convene
it, break ties, and make agreed roles stick (claims + commitments it serializes).
Across operators there is no shared sovereign, so the same round must be enforced
by **bonds**, not fiat. Same conversation; different teeth. This is not a wart —
it is *why Paper 4 exists* (truthful signaling is a Nash equilibrium only inside
one operator's box; δ\* ≈ 0.3425, machine-checked).

## Concept 2 — Peer suggestibility + the parley protocol

Extends ADR-0039 (suggestibility) from operator→agent coaching to **agent↔agent**.
Today an agent knows what *files* others touch (claims). The bolder version:
an agent is alerted that **another agent is doing a similar *thing*** — and the
swarm can escalate from informal parallel work into a structured negotiation.

**The mode switch (the parley):**
> informal parallel work → *(convergence detected)* → suspend → **parley**
> (a typed, multi-party Contract-Net round: shared plan, goals, role allocation)
> → break → resume, now coordinated.

This is the agent-world analog of the operator's force-zoom / HITL escalation.

**What exists vs. what is net-new.** The *parts* exist in the L1 substrate
(Paper 1): the tube (inbox), the pheromone blackboard (ambient reality), claims
(who touches what), typed performatives (`cfp`/`agree`/`refuse`/`decide`/
`finalize` — Contract-Net *is* a parley), and commitments (a parley's durable
output). Net-new is **two** things, and the hard one is not the parley:
1. **The convergence detector** — "another agent is doing a similar thing." This
   is the hard open problem already named in the layer dossiers: duplication/loop
   detection that distinguishes legitimate parallelism from collision **without
   keyword matching** (semantic task-shape similarity).
2. **The cost-aware trigger** — convene too eagerly and coordination overhead
   kills the parallelism you wanted (the realism-check's MAS-overhead warning);
   too rarely and you get duplicated/conflicting work. The trigger is a
   **Signal-Detection** problem (asymmetric miss/false-alarm cost), the same
   structure as the operator's force-zoom threshold.

**Per-turn context as the agent's control plane.** "Controlling what an agent
sees every turn" (suggestibility briefing + inbox + pheromone reality + others'
claims + recent commits) *is* the agent's cockpit. It is a read-economics
problem: what to inject, at what token cost (COGS), at what fidelity
(digest-with-zoom, so the agent can drill from "someone is near your file" to
the actual diff).

## Concept 3 — The shared-memory depth ladder

The recursion can go *deeper in substrate*, not just wider in scope:

> shared **bulletin** (text) → shared **blackboard** (pheromone) → shared
> **memory** (witnessed records) → shared **learned representation** (neural)

Each rung is more powerful and **less legible**. The sharp tension:
**shared neural memory breaks the one law of Paper 2 — digest-with-zoom.** You
can zoom from a shared *record* to its artifact; you cannot zoom into a shared
*weight/embedding* to see why it says what it says. It is an un-inspectable
channel — and across harbors (no shared sovereign) it is a poisoning/backdoor
surface that bonds cannot price, because you cannot *witness* what is in it.

**The safe, buildable version** of "shared memory that cuts across harbors /
daemons / agent-types / durable roles" is a **shared, attested store of witnessed
outcomes keyed on non-forgeable identity** — i.e. the outcome ledger (Paper 3)
and the witness log (Paper 4) generalized into a cross-cutting memory.

**Open problem (a good one):** how do you make a *learned* structure
**attestable without making it inspectable** — so the deepest rung keeps the
legibility and bonding guarantees the shallow rungs have?

## Concept 4 — Evolutionary dynamics (Papers 3 + 4 run forward in time)

generations / cross-over / quality-evaluation / reproduction / stable ecosystem
dynamics map cleanly onto primitives that already exist:

| Evolution | Port-daddy primitive |
|---|---|
| fitness | the witnessed **outcome ledger** (reputation) |
| fitness function | the **grading oracle** |
| selection pressure | **bonds / slashing** |
| lineage | **non-forgeable identity** |
| reproduction | **spawn** |
| variation / cross-over | *missing* — recombining roles / skills / prompts / configs |

Selection + fitness + lineage already exist; what is missing are the
**variation + inheritance operators** and the **ecosystem-stability analysis**.
The danger is the one the §8.4.4 Monte-Carlo sims already flag, at fast-forward:
**selection on a gameable fitness function is Goodhart at speed** — monoculture
collapse, cartel capture, wash-trading. Evolution makes **grading-oracle
integrity existential**, not merely important.

**Where it belongs:** not a fifth paper. It is what Papers 3 + 4 look like as a
*dynamical system*, and its proper output is a **sandbox / simulation** whose
results become evidence (more §8.4.4-style Monte-Carlo) under Paper 4. Seed
already exists: the `research/evolutionary-agent-coordination-sandbox` branch
(PR #228).

---

## Where these land in the canon

- **Concept 1** sharpens **Paper 2's thesis** from "the operator sees the swarm"
  to "everyone who must coordinate gets a legible, suggestible view of everyone
  else," and explains the Paper 1 / Paper 4 split as a *symmetry break*, not just
  a difficulty jump.
- **Concept 2** deepens **Paper 1's** L1 substrate (the parley protocol) and is
  the agent-side of **Paper 2's** legibility.
- **Concept 3** generalizes **Paper 3's** outcome ledger + **Paper 4's** witness
  log into a cross-cutting shared memory; the neural rung is an open frontier.
- **Concept 4** is the forward-time dynamics of **Papers 3 + 4** — research track,
  not canon.

## Open research items (promote to the Ledger / roadmap)

> **Promoted 2026-06-19** into the Ledger as
> `docs/research/north-star/00-THE-LEDGER-open-problems.md` § D (Recursive control
> plane), with source-verified maturity and cross-links to the PRV/RQ/IMP rows.
> The list below remains the prose source; the Ledger is the authoritative registry.

> **Source-audit correction (2026-06-19).** The RCP items below were grafted from
> summary memos. A read-only audit of the two source repos as they actually stand
> — `docs/research/grafts/2026-06-19-soma-windags-source-audit.md` — corrected
> several maturity claims before they harden into roadmap commitments. In short:
> soma's "sheaf" is a **graph Laplacian** (cohomology/restriction-maps **absent**,
> not "the math is there" → RCP-8, RCP-5b are aspirational); windags' **Thompson**
> trust signal was **rejected as a "category error"** and replaced by
> attribution-kNN (re-attribute RCP-4a/6a); monster-barring (RCP-6b) and
> io-contract runtime validation (RCP-13) are **design-only**; the coverage delta
> (RCP-12) and the 34.78%→4.35% figure are **not benchmarked on the source repos**.
> What *is* shipped and portable: soma's graph-diffusion + expected-free-energy
> agent, and windags' retrieval cascade + economic eval gate + typed discourse bus.
> See the audit for `path:line` and the port plan.

- **RCP-1 — Convergence detector.** Semantic task-shape similarity for "another
  agent is doing a similar thing," without keyword matching. *(Hard; gates the
  parley. Both source repos match at task-PLAN time; neither detects RUNTIME
  overlap between active agents — the real gap.)*
  - *1a (windags):* BM25 → cosine-RRF → cross-encoder → attribution-kNN cascade
    (`packages/core/src/core/skill-matcher.ts`), adapted from skill-matching to task-shape.
  - *1b (windags):* run that cascade on live **agent outputs**, not task
    descriptions, to catch two agents converging on the same claim. *(open)*
- **RCP-2 — Parley trigger.** Cost-aware (Signal-Detection) threshold for when to
  break formation and convene; avoid MAS-overhead Goodhart.
  - *2a (windags):* the four-layer-eval `P(fail) × waste > cost` formula reused
    as the parley-vs-proceed decision.
  - *2b (soma/survey):* the stigmergic **density threshold ρ\*** (phase transition
    independent → synchronized) as a self-organization trigger.
- **RCP-3 — Parley protocol.** Typed multi-party Contract-Net round over the
  existing performatives that outputs role allocation + commitments.
  - *3a (windags):* **wave-by-wave reconvention** — parley scheduled at wave
    boundaries when TENTATIVE nodes / premortem-risk exist, not ad-hoc.
  - *3b (windags):* a **discourse-typed bus** — FIPA `act/respondingTo/relationship/thesis`
    on every message (port-daddy's pub/sub is currently untyped).
- **RCP-4 — Attestable-but-not-inspectable learned memory.** Make the learned rung
  carry attestation/bonding guarantees.
  - *4a (windags):* **Thompson posteriors (α/β)** as narrow verifiable trust
    intervals — attestable without revealing method internals.
  - *4b (soma):* keep soma's week-4 V(D)J "memory cells" as **attested signed
    hashes**, never opaque weights — or digest-with-zoom breaks.
- **RCP-5 — Cross-harbor shared outcome store.** Attested witnessed-outcome memory
  keyed on non-forgeable identity.
  - *5a (survey):* *Collaborative Memory* — two-tier private/shared stores with
    **provable adherence to time-varying RBAC**.
  - *5b (soma):* **sheaf restriction maps** on boundary simplices as the
    cross-operator projection / bonds-boundary mechanism. *(unbuilt)*
- **RCP-6 — Variation / inheritance operators.** For the evolutionary track.
  - *6a (windags):* **method-level inheritance** — methods (decomposition patterns,
    prompt templates) heritable across skill versions; skills ephemeral.
  - *6b (windags):* **monster-barring** (Lakatos) — `NOT_FOR`-growth >
    `WHEN_TO_USE`-growth per revision = a degeneracy/selection signal.
- **RCP-7 — Ecosystem-stability analysis.** Convergence to healthy diversity vs.
  collapse (monoculture / cartel). Extends the §8.4.4 sims.
  - *7a (soma):* **anti-inflammatory resolution traces** (inverse-pheromone after a
    fix) as immune-tolerance against computational autoimmunity.

### New axes (not covered by 1–7)

> **Numbering note.** The soma and windags memos each independently proposed
> "RCP-8/9" with *different* meanings. Reconciled here: source-specific mechanisms
> became `Na` refinements above; only genuinely new axes get fresh numbers below.

- **RCP-8 — Sheaf-cohomology coordination-health telemetry.** `H¹(𝓕)` /
  sheaf-Laplacian Dirichlet energy as a first-class legibility + debuggability
  metric ("debug the sheaf, not the swarm"). **Triple convergence:** the survey
  (game-sheaves: Nash = global sections, `H¹≠0` = unresolvable strategic
  inconsistency), soma (`H*(K,𝓕)` diagnostics), and our Ledger (cross-harbor
  settlement = an `H¹` gluing obstruction, PRV-12/13). One object, three roles:
  a Paper 2 metric, a Paper 4 impossibility diagnostic, a debugger.
- **RCP-9 — Provable action adjudicator.** Lean-Agent-style auto-formalization of
  policy into axioms, adjudicating each action Proven/Refuted at µs latency — the
  *provable* reference monitor the containment story (Paper 1, machine-side) needs.
- **RCP-10 — Pre-federation halt gate.** A validity check (windags' Polya
  principal-parts gate) that must pass *before* work decomposes or bonds are
  written — a problem must be well-defined before it can be coordinated or traded.
- **RCP-11 — Wide-market typed-trace goods.** soma's multi-commodity market over
  typed traces (PHEROMONE / BELIEF / PREFERENCE / ANTIBODY / RESOLUTION) — an
  economic primitive for Paper 4.
- **RCP-12 — Coverage guarantee (epistemic scan).** soma's innate drive (fire with
  P ∝ unseen/total; teleport to novel nodes) guaranteeing **no node is permanently
  invisible** — a built legibility primitive (100% vs 50% coverage).
- **RCP-13 — Inter-agent output contracts.** windags' `io-contract` frontmatter +
  `ContractValidator`: runtime schema validation between agents before downstream
  propagation — an attestation primitive port-daddy lacks.
- **RCP-14 — Argumentative lineage.** windags' `SwarmTracer` epistemic-ancestry
  spans (Toulmin claim/data/warrant) — digest-with-zoom for *reasoning provenance*,
  and the structure RCP-8 / RCP-1b need to compare claims.

---

## Graft points

### `erichowens/soma` — the substrate (the Medium)
A cellular-sheaf stigmergy platform: agents coordinate by modifying a shared
medium (typed pheromone traces over a dynamic simplicial complex) and selecting
actions by **active-inference free-energy minimization** — no orchestrator, no
message bus. **Weeks 1–2 shipped** (medium, stigmergic + active-inference agents,
epistemic scan, 62 tests green); **weeks 3–4 scaffolded, unbuilt** (belief markets
are an enum value with no auction; immune selection has no code).
- **It *is* C1/C3 made concrete.** The Medium is the recursive control plane's
  fabric; typed stalks `𝓕(σ) = P ⊕ B ⊕ Π ⊕ A` are the depth-ladder rungs;
  restriction maps hint at the federation bonds-boundary (RCP-5b).
- **It validates the survey's frontier triad by *building* it** (sheaves = *what*,
  free-energy = *why*). Maps: Paper 1 = the Medium as distributed reference
  monitor; Paper 2 = epistemic scan (RCP-12); Paper 3 = sheaf-position identity +
  antibody memory; Paper 4 = restriction maps (unbuilt).
- **Contributes:** RCP-8, RCP-11, RCP-12, RCP-7a, RCP-5b, RCP-4b.
- **Watch:** keep week-4 learned memory attested-hash, not weights (RCP-4b); the
  pitch overclaims markets/selection as shipped — weeks 1–2 alone are a complete
  substrate story; separate the paper from the implementation claims.

### `curiositech/windags` — the orchestration + evaluation + skill machinery
A single-operator DAG orchestrator for Claude Code: decompose → match each
subtask to a skill (4-stage retrieval) → inject a **4-branch prompt hypertree**
(Identity / Context / Task / Protocol) → execute in parallel waves → score via a
four-layer quality model. **DAG executor + retrieval + eval shipped (~1,350
tests); learning loop (curator → crystallization → Knowledge Library) designed,
not wired** (a 16-week gap).
- **It *is* C2 + the per-turn suggestibility model.** The 4-branch hypertree is
  literally "what each agent sees every turn"; FIPA `SwarmDiscourse` is typed
  performatives; wave boundaries are natural parley schedules.
- **It carries the C4 machinery:** Thompson-sampling @ method level = heritable
  variation (RCP-6a); monster-barring = a Lakatosian selection signal (RCP-6b).
- **Contributes:** RCP-1a/1b, RCP-2a, RCP-3a/3b, RCP-4a, RCP-6a/6b, RCP-10,
  RCP-13, RCP-14.
- **Watch:** RCP-1 is still open — windags matches task-shape at *plan* time, not
  running-agent overlap at *run* time; no MAS-overhead model; single-operator (no
  bonds).

### Survey (`agenticswarmcoordination.md`) — the academic + empirical backbone
External validation (single-writer is industry-converged: Cognition + Anthropic),
the MAST failure data (79% of failures are coordination not intelligence;
Incorrect Verification is the top predictor; the inspector pattern recovers
96.4%), the formal apparatus (sheaves / free-energy / mean-field → RCP-8, RCP-2b,
async belief-sync), and the honesty rail (multi-agent is a *precision instrument*,
not a general upgrade — single-agent wins ~80% of workflows).

## Skills worth porting (from windags)
High-value first: **`next-move`** (5-agent meta-DAG: halt gate + retrieval +
waves), **`agent-conversation-protocols`** (6 typed dialogue topologies → RCP-3b),
**`coordination-topology-architect`** (1-operator → N-operator routing),
**`multi-agent-coordination`** (worktree isolation + conflict heuristics),
**`windags-premortem`** (risk-adjusted confidence → RCP-2), and the FIPA set
(`fipa-00037` communicative acts, `fipa-00025` interaction protocols,
`smith-1980-contract-net`) for the RCP-3 parley vocabulary.
