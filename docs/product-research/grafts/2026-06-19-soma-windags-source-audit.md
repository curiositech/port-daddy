# Source-verified graft: `soma` + `windags` (2026-06-19)

> Status: **research / exploratory.** Companion to
> `whitepaper/research/program/archive/control-plane/2026-06-15-recursive-control-plane.md` (the conceptual graft;
> RCP-1…14). That doc grafted the *ideas* from `erichowens/soma` and
> `curiositech/windags` (read here as `~/coding/workgroup-ai`) from summary
> memos. This doc grafts the *source* — a read-only audit of both repos as they
> actually stand on 2026-06-19, separating **shipped** from **scaffolded** from
> **aspirational**, with `path:line` citations. Its job is to (a) pin the
> genuinely portable kernels so an implementer can lift them, and (b) correct the
> overclaims the memos carried into the RCP list before any of it hardens into a
> roadmap commitment.

The headline: the conceptual graft is sound, but it inherited a *maturity*
inflation from both repos' own framing. Two mechanisms the RCP list leans on —
soma's **sheaf** structure and windags' **Thompson** trust signal — do not exist
as shipped code. One (sheaf) is week-2+ aspiration sitting on a graph-Laplacian
base; the other (Thompson) was **explicitly rejected and is scheduled for
deletion**. The good news is larger: the *buildable* kernels under both (graph
diffusion + expected-free-energy action selection; a 4-stage retrieval cascade +
an economic evaluation gate + a typed discourse bus) are real, tested, and map
cleanly onto port-daddy primitives.

---

## TL;DR — corrections the source forced

| RCP / claim | Memo & §6-15 doc said | Source says | Correction |
|---|---|---|---|
| RCP-8 sheaf-cohomology telemetry | soma "builds it" (`H*(K,𝓕)`) | **Absent.** No cohomology, no Dirichlet energy. Diffusion is a **graph Laplacian** (`soma/medium.py:9`); `medium.py:6` says "**trivial restriction maps**" | Demote to *aspirational*; soma does **not** validate it |
| RCP-5b sheaf restriction maps (federation) | "the math is there (unbuilt)" | **Absent in code**; stalks are a flat per-node list, not a stalk functor | Keep "unbuilt"; drop "the math is there" — the *framing* is there, not the math |
| RCP-12 coverage guarantee (epistemic scan) | "BUILT (100% vs 50% coverage)" | Mechanism **BUILT** (`active_inference_agent.py:203`); the **50%→100% number is not benchmarked** — no regression test asserts it | Keep BUILT; mark the coverage delta *claimed, not measured* |
| RCP-4a Thompson posteriors (α/β) trust intervals | windags ships them | **Rejected.** windags `CLAUDE.md:86` calls Thompson/Beta a "**category error**"; `SkillQualityStore` Beta path "**scheduled for removal**"; replaced by **attribution-kNN** (`skill-matcher.ts:56,570`) | Re-attribute: the *shipped* signal is attribution-kNN over a (task → skills → accept/reject) store, **not** Thompson. The narrow-interval idea survives as aspiration, not as windags precedent |
| RCP-6a/6b method inheritance + monster-barring | windags "carries the C4 machinery" | 6a (method-level Beta inheritance): tied to the rejected Thompson path. 6b (monster-barring): **design-only** in `lakatos-v2/` reference material, no runtime detector | Mark both *design-only*; 6a needs a non-bandit reformulation |
| RCP-13 io-contracts (runtime validation) | "runtime schema validation between agents" | `input_contract`/`output_contract` are **free-text metadata** on DAG nodes; **no `ContractValidator`**, nothing validates outputs against downstream inputs | Demote to *metadata-only*; runtime validation is the open work |
| "Haiku Stage-1 gate" (RCP-2a) | Haiku gates Stage 1 | Stage 1 (floor/wall/envelope) is **deterministic, zero-LLM**; Haiku is an **optional Stage 2** (`haikuCallFn` unconfigured by default) | The `P(fail)×waste>cost` formula is real and wired; the gate is *deterministic*, Haiku is conditional escalation |
| Progressive Revelation "8× (34.78%→4.35%)" | windags result | Metric is from **external literature** (TDAG / HTN-SHOP2 reference docs under `windags-avatar/`), **not measured on windags**; on-demand vague-node expansion executor is **not wired** | Cite as borrowed motivation, not a windags benchmark |

Everything below substantiates these with the full per-repo audit and the
portable-kernel extraction.

---

## soma — the stigmergic substrate (verified)

`~/coding/soma` is a Python active-inference stigmergy platform. **Weeks 1–2 are
real and tested (62 tests: 20 substrate + 42 active-inference); weeks 3–4
(markets, immune selection, memory cells) are enum values and stubs.**

### Status table

| # | Claim | Status | `path:line` | Note |
|---|---|---|---|---|
| 1 | Medium: typed stalks P ⊕ B ⊕ Π ⊕ A + RESOLUTION | **BUILT (as graph, not sheaf)** | `soma/medium.py:42-47` enum; `:9` Laplacian | `TraceType` = {PHEROMONE, BELIEF, PREFERENCE, ANTIBODY, RESOLUTION}; stored as flat per-node scalars, not a stalk functor |
| 1b | sheaf-Laplacian diffusion | **graph Laplacian only** | `medium.py:6,9`; diffusion `:349-358` | `Σ_{u~v}(p_u − p_v)`; Euler-stable (`:346` clamps `dt ≤ 0.9/(α·d_max)`); seeded-deterministic. "sheaf Laplacian (week 2+)" is a comment, not code |
| 2 | Active-inference agent: Beta beliefs + EFE selection | **BUILT** | `active_inference_agent.py:31`; `generative_model.py:57-227`, EFE `:156` | softmax over `−γ·G(n)` (`:207`), **no ε-greedy**; precision weights adapt via surprise history |
| 3 | Epistemic scan (fire ∝ unseen/total, teleport) | **BUILT; coverage claim unverified** | `active_inference_agent.py:203-214` | `scan_prob = |unseen|/|all_nodes|`; 50%→100% delta has **no asserting test** |
| 4 | "62 tests passing" | **ACCURATE** | `tests.py` (20) + `tests_active_inference.py` (42) | deterministic, CI-friendly |
| 5 | Belief markets | **SCAFFOLDED** | `medium.py:44` enum only | comment "tradeable in market"; **no auction/tâtonnement code** |
| 6 | Immune / negative selection | **SCAFFOLDED** | `agent.py:222` `clone()` stub never called | antibody *check* is real (`medium.py:277`), population culling is not |
| 7 | Resolution traces (anti-inflammatory damping) | **BUILT** | `medium.py:189-192,214-216`; test `tests.py:123` | multiplicative damping `effective = raw·(1 − d·res)`; faster decay than pheromone |
| 8 | Sheaf cohomology `H*(K,𝓕)` diagnostics | **ABSENT** | — | aspirational in proposal only |
| 9 | Restriction maps on boundary simplices | **ABSENT** | `medium.py:6` "trivial" | no federation / hierarchical soma |
| 10 | V(D)J "memory cells" | **ABSENT** | — | `clone()` mutates weights; no recombination, no archive |

`framework_proposal.md` presents markets + immune selection as part of the
system; the code is weeks 1–2. **Weeks 1–2 alone are a complete substrate
story** — recommend grafting that and dropping the sheaf/immune framing until it
ships.

### Portable kernel (soma)

Two mechanisms are worth lifting wholesale; both are small, deterministic, and
dependency-light (`numpy` + a graph).

**K1 — Graph-diffusion Medium.** A blackboard where deposits decay and diffuse:
`tick(dt)` = decay (`p *= exp(−γdt)`) → diffuse (`p += α·dt·L·p`, `L` the graph
Laplacian, `dt` stability-clamped) → prune near-zero. `deposit(node, intensity)`,
`sense(node, radius)`, `gradient(node)` (discrete exterior derivative). This is
the honest version of port-daddy's pheromone blackboard: transient, bounded,
seed-reproducible. *(`soma/medium.py:311-394`.)*

**K2 — Expected-free-energy action selection.** Per target, a `NodeBelief(α, β)`
Beta posterior; pick the next target by softmax over
`G(n) = w_prag·(−E[p]) + w_epist·(−Var[p]·novelty(n))` — exploit where you expect
payoff, explore where you're uncertain, **no tuned ε**. Precision weights
`w_prag, w_epist` self-adapt from a surprise trace. *(`generative_model.py:156-225`,
`active_inference_agent.py:75-161`.)* This is the principled core a **convergence
detector / task-selection policy** (RCP-1, RCP-2) can sit on: "uncertainty ×
novelty" is exactly the signal that tells an agent whether a peer's in-flight
work makes its own redundant.

**Also small & real:** antibody-check (`check_antibody(sig)` → skip known
patterns, `medium.py:277`) and resolution-damping (deposit RESOLUTION → suppress
pile-on, `medium.py:214`). Both map to port-daddy's claim/suggestion lifecycle:
"someone already solved this" and "this is resolved, stop converging here."

---

## windags — orchestration + retrieval + evaluation (verified)

`~/coding/workgroup-ai` is a single-operator DAG orchestrator for Claude Code.
**The retrieval + evaluation + wave-execution + discourse-tracing core is real
and wired (~1,350 tests); the learning loop and Thompson/monster-barring trust
machinery are not.**

### Status table

| # | Claim | Status | `path:line` | Note |
|---|---|---|---|---|
| 1 | 4-stage retrieval: BM25 → RRF → cross-encoder → attribution-kNN | **BUILT + WIRED** | `packages/core/src/core/skill-matcher.ts`: BM25 `:161`, RRF `:346`, cross-encoder `:360`, attribution-kNN `:573` | `text-embedding-3-small` default; degrades to BM25 if no key; called during node skill-assignment |
| 2 | Four-layer eval + `P(fail)×waste>cost` | **BUILT + WIRED** (Stage-1 deterministic) | `packages/core/src/observability/evaluation-engine.ts`: floor `:98`, wall `:105`, envelope `:116`, escalation `:218-230` | Stage-1 is zero-LLM; Stage-2 (ceiling) infra ready, `haikuCallFn` unconfigured by default |
| 3 | Thompson sampling @ method level (α/β) | **REJECTED / scheduled for removal** | `CLAUDE.md:86,313,394`; `skill-matcher.ts:56,570` | "category error… skills are not fungible bandit arms"; replaced by attribution-kNN |
| 4 | Monster-barring (Lakatos degeneracy signal) | **DESIGN-ONLY** | `lakatos-v2/Lakatos_SKILL.md`, `Lakatos_knowledge_map.json` | reference material; no runtime detector over skill revisions |
| 5 | Commitment levels COMMITTED/TENTATIVE/EXPLORATORY | **PARTIAL** | `types/dag.ts` `CommitmentLevel`; used at `evaluation-engine.ts:61` | sets base `P(fail)`; **not** wired to differential model/retry/budget allocation |
| 6 | Halt gate (validity < 0.6 → halt before decompose) | **BUILT + WIRED** | `context/meta-dag-predict.ts:~700` | Wave-0 sensemaker emits `{type:'halt'}`, blocks Wave-1 |
| 7 | Wave execution + 6 topologies | **BUILT + WIRED** | `packages/core/src/core/topology.ts`; `packages/core/src/topologies/index.ts` | DAG/Team/Swarm/Blackboard/TeamBuilder/Recurring |
| 8 | Progressive Revelation; 34.78%→4.35% | **DESIGN-ONLY; metric external** | metric in `…/windags-avatar/windags-constitution-v3.md`, `wang-et-al-2025-tdag/` | on-demand vague-node expansion not wired; metric borrowed from TDAG/HTN literature, not measured here |
| 9 | io-contracts + `ContractValidator` | **METADATA-ONLY** | `types/next-move.ts:80-90` | free-text `input_/output_contract`; **no validator** |
| 10 | `SwarmTracer` epistemic-ancestry (Toulmin) | **BUILT + WIRED** | `topologies/swarm-tracer.ts` | records `SwarmExecutionSpan.discourse[]`, builds lineage graph |
| 11 | FIPA `SwarmDiscourse` typed performatives | **BUILT + WIRED** | `topologies/swarm.ts:34-43` | `act ∈ {inform,propose,counter,refine,synthesize,query}`; `relationship ∈ {supports,contradicts,extends,narrows,synthesizes}` |
| 12 | Learning loop (curator→…→Knowledge Library) | **DESIGN-ONLY / dead code** | `observability/pattern-learner.ts` never instantiated | `windags_analysis.md`: "No persistent Knowledge Library implementation" |
| 13 | Skills exist: next-move, premortem, agent-conversation-protocols, coordination-topology-architect, multi-agent-coordination | **PRESENT** | `skills/*/SKILL.md` | next-move is the live `/next-move` runner |

### Portable kernel (windags)

**K3 — The retrieval cascade is the answer to "no keyword NLP."** port-daddy's
own house rule bans keyword/substring classification of free text; windags'
`SkillMatcher` is a working, tested implementation of the sanctioned
alternative: BM25 → reciprocal-rank fusion with embedding cosine → optional
cross-encoder rerank → blend with **attribution-kNN** (priors learned from prior
(task → selection → accept/reject) triples). This is directly the substrate
**RCP-1's convergence detector** needs — run the cascade over *agent task-shapes
/ live outputs* instead of skill descriptions and you get semantic overlap
without a keyword list. *(`skill-matcher.ts:161-625`.)*

**K4 — The economic evaluation gate is the parley-trigger formula, shipped.**
`evaluation-engine.ts` computes a deterministic stress/quality score for free,
then escalates to a costed LLM review **only when** `P(fail)×downstreamWaste >
reviewCost`. That is exactly **RCP-2's** signal-detection parley trigger
(convene only when the expected cost of *not* coordinating beats the coordination
overhead), already reduced to a wired formula. Lift the formula; swap "LLM
review" for "convene a parley." *(`evaluation-engine.ts:218-230`.)*

**K5 — Typed discourse bus.** `SwarmDiscourse` (FIPA-flavored `act` +
argumentative `relationship`) and `SwarmTracer` (per-span discourse lineage) are
the concrete form of **RCP-3b** (typed performatives on port-daddy's currently
untyped pub/sub) and **RCP-14** (argumentative lineage / digest-with-zoom for
reasoning provenance). Port the two interfaces and the span recorder.
*(`topologies/swarm.ts:34-43`, `topologies/swarm-tracer.ts`.)*

**The halt gate (RCP-10)** is also real and tiny — a confidence threshold that
refuses to decompose an ill-posed problem. Worth porting verbatim as the
pre-coordination validity check.

---

## Port plan into port-daddy primitives

The three highest-value grafts, mapped onto surfaces that already exist:

1. **Retrieval cascade → the convergence detector (RCP-1).** port-daddy already
   has embedding + BM25 infra and a claim-overlap detector (ADR-0039 /
   `lib/suggestions.ts`). Graft K3's cascade shape (RRF + attribution-kNN over an
   accept/reject store) and run it over **live agent task-shapes**, not skill
   text — the one thing neither source repo does (both match at *plan* time).
   This is the genuinely-open RCP-1b.
2. **Economic gate → the parley trigger (RCP-2).** Lift K4's
   `P(fail)×waste>cost` and bind it to the existing `pd nudge` /
   suggestion-broker path: a nudge escalates to a structured parley only when the
   formula clears. Deterministic, costed, no MAS-overhead Goodhart.
3. **Typed discourse + lineage → RCP-3b / RCP-14.** Add K5's `act`/`relationship`
   typing to port-daddy's pub/sub envelopes and record discourse spans alongside
   the outcome ledger. This is the attestable reasoning-provenance layer the
   witness log (Paper 4) wants.

soma's **K1/K2** stay research-track: they belong to the evolutionary-dynamics
sandbox (the research cluster at `docs/product-research/raw/agent-coordination-sandbox-2026-06-03/`,
landed in #397 — PR #228 was closed as a stale, revert-dangerous branch and
superseded), where EFE action selection can drive variation/selection under
a grading oracle — *not* in the daemon hot path yet.

**Explicitly not yet portable:** sheaf cohomology (RCP-8), restriction-map
federation (RCP-5b), Thompson trust intervals (RCP-4a — needs a non-bandit
reformulation), monster-barring (RCP-6b), io-contract runtime validation
(RCP-13). These remain open research items; the audit just moves them from
"a source repo proves this" to "a source repo *names* this."

---

## Provenance notes

- **Thompson rejection (windags).** Not an omission — a decision. `CLAUDE.md:86`:
  "skills are heterogeneous, not fungible arms… any code or comment that uses
  bandit vocabulary is a category error." The shipped signal is contextual
  retrieval + attribution-kNN over a private (task, skills, accept/reject) triple
  store plus cross-user global priors (`api.windags.ai`). Any RCP item that cited
  Thompson as windags precedent should cite **attribution-kNN** instead.
- **34.78%→4.35% (windags).** Originates in external task-network planning
  literature (TDAG / HTN-SHOP2), surfaced in the `windags-avatar` persona
  reference docs as *motivation* for progressive decomposition. It is not a
  measurement of windags' own runtime, which does not implement on-demand
  vague-node expansion.
- **"sheaf" (soma).** `medium.py:9` is candid: "graph Laplacian (week 1) / sheaf
  Laplacian (week 2+)." The shipped weeks-1–2 substrate is a graph; the sheaf is
  a roadmap label. The triad framing (sheaves = *what*, free-energy = *why*) holds
  for the **free-energy** half (built) and is aspirational for the **sheaf** half.

---

*Audit method: two read-only passes over `~/coding/soma` and
`~/coding/workgroup-ai` on 2026-06-19, plus direct re-verification of the two
load-bearing corrections (graph-vs-sheaf Laplacian at `soma/medium.py:6,9`;
Thompson rejection at windags `CLAUDE.md:86,313,394` and `skill-matcher.ts:56,570`).
No files in either source repo were modified.*
