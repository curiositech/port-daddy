# Skill I/O and the Composition Algebra of the Catalog

> Status: **research.** Written 2026-08-19, alongside the first-hop candidate
> expansion in `lib/skill-graft.ts` (same PR). Audience: the operator and
> anyone authoring or wiring skills. Companion pieces:
> `docs/product-research/grafts/2026-06-19-soma-windags-source-audit.md` (where the
> io-contract idea's real maturity was pinned) and the north-star volume's
> honesty contract (`whitepaper/research/program/archive/north-star/README.md`), which we inherit:
> **[BUILT]** means code on disk in this repo today, **[DESIGNED]** means an
> accepted shape with no merged enforcement, **[PROPOSED]** means we are
> arguing for it here for the first time.

The operator asked for two things: a clear account of what a skill's input
and output actually are, and some honest thought about the clever
compositions the 301-skill catalog makes possible. We take both in order,
grounding every claim in files that exist.

---

## 1. A skill is a partial function over agent context

A `SKILL.md` is not documentation. It is a **partial function signature over
agent context**: it declares the region of task-space where it applies (the
`description`'s trigger conditions — its domain), the region where it
explicitly does not (the NOT-for clause — the domain's declared complement),
and what an agent that loads it will produce differently (decision
procedures, deliverable shapes, vetoes — its codomain). "Partial" is doing
real work in that sentence: a skill grafted outside its domain is undefined
behavior, which is why activation precision — not coverage — is the quality
bar `skills/skill-architect/SKILL.md` enforces with its
`[What] [When to use]. NOT for [Exclusions]` description formula.

The system around the catalog already treats work units this way. The
planner triple that `skills/next-move/SKILL.md` stores under
`.windags/triples/` (line 144; Step 9, "Store the Triple") records context,
predicted DAG, and accept/reject — and every node of that predicted DAG is
required to carry an **input contract** and an **output contract** ("input
contract per node; output contract per node when downstream consumes
structured output", `skills/next-move/SKILL.md` Step 6). The node shape is
mirrored three more times in this repo:

- `skills/next-move/references/skillful-node-execution.md` — the Node
  Contract JSON, with structured `input_contract.required_inputs` /
  `upstream_nodes` and `output_contract.format` / `fields`;
- `core/pd-console/src/work_plan.rs` (`PredictedNode.input_contract` /
  `output_contract`, rendered in the inspector as `⊢ in` / `⊣ out`);
- `core/pd-conjure-proto/src/dag.rs` (the same fields on the proto mirror).

So the *node* shape is contract-carrying today. The honest caveat, which the
source audit already forced us to write down once: those contracts are
**free-text metadata, not validated types**. The windags source audit's
RCP-13 row is blunt — "`input_contract`/`output_contract` are free-text
metadata on DAG nodes; no `ContractValidator`, nothing validates outputs
against downstream inputs" (`docs/product-research/grafts/2026-06-19-soma-windags-source-audit.md`,
TL;DR table and windags status row 9). Nothing in this repo has changed that
status. When we say "typed" below, we mean "named and checkable in
principle," not "checked."

### What the catalog declares today (2026-08-19 inventory)

We scanned all 301 `skills/*/SKILL.md` frontmatters (same defensive parse as
`lib/shipwright/skill-index.ts`):

| Declaration | Count | Share |
|---|---|---|
| Skills in catalog | 301 | — |
| `description` with an explicit NOT-for clause | 241 | 80% |
| `pairs-with` edges (frontmatter — top-level or under `metadata`, object- or bare-string entries) | 205 | 68% |
| `io-contract` frontmatter (`kind`/`consumes`/`produces`) | 166 | 55% |

Read as a type system, that is: four in five skills declare their domain's
complement; two in three declare at least one intended composition partner;
over half already declare a produce (and sometimes consume) shape — e.g.
`skills/agent-work-receipt-designer/SKILL.md` declares
`consumes: backend-task-log, validation-artifacts` and
`produces: work-receipt, receipt-lint-report`, all with formats. What no
skill declares, because nothing consumes it, is a *checkable* schema: the
`io-contract` kinds are a folksonomy (`design-doc`, `critique`,
`refactor-plan`, `audit-report`…), not a registry. A typed contract would
add three things the folksonomy cannot give us: (1) design-time
composition checking (does A's produce-kind appear among B's
consume-kinds?), (2) mechanical detection of dangling compositions (a kind
produced by nobody, consumed by nobody — the operad skill's "phantom type"
anti-pattern, `skills/operad-task-decomposition/SKILL.md`), and (3) a
ranking signal for the graft engine that is stronger than prose co-mention.
All three are cheap *because* 166 skills already opted into the field.

---

## 2. The empirical composition graph

The first-hop expansion landed in `lib/skill-graft.ts` this PR builds a
directed, weighted skill graph from two text signals: a curated `pairs-with`
edge (weight 1.0) and an incidental prose mention of another skill's
hyphenated id (weight 0.4) — `buildSkillAdjacency()`, with the weights and
their rationale as named constants (`PAIRS_WITH_WEIGHT`,
`PROSE_MENTION_WEIGHT`, `HOP_DECAY`). Before choosing the expansion policy
we measured the graph. The analysis of record (2026-08-19, recorded in the
section banner above `expandFirstHopCandidates()` in `lib/skill-graft.ts`):

| Measure | Value |
|---|---|
| Skills | 301 |
| First-hop out-degree | median 3, max 10 |
| Zero-out-degree skills | 70 |
| Transitive-closure size | median 40, max 145 |
| Skills whose closure exceeds 100 | 39 |
| Giant-component hubs | `multi-agent-coordination`, `skill-architect` (21 in-links each) |

While writing this we re-ran an independent mirror of the same scan and got
the same shape with small deltas (zero-degree 75 vs 70, closure median 30
vs 40, max 144 vs 145, hubs `multi-agent-coordination` and `skill-architect`
still first and second by in-degree). The deltas are parser sensitivity —
which frontmatter locations count, whether a bare-string `pairs-with` entry
counts as a curated edge (22 skills declare that shape; `buildSkillAdjacency`
accepts both), how hyphenated prefixes match — and that
is itself a finding: this graph is **text-mined, not declared**, so every
consumer must treat exact counts as approximate and the *shape* as the
signal.

Three things the shape tells us:

**`pairs-with` edges are typed composition hints, not dependencies.** A
median out-degree of 3 with a hard ceiling of 10 means authors curate a
handful of intended partners, usually with a one-line `reason` that reads
like a contract ("the tracker provides the real-time cost data that the
optimizer uses" — `skills/cost-optimizer/SKILL.md`). Nothing breaks if the
partner is absent. These are affordance edges: *if you loaded me, these
compose well with me.*

**The giant component is a shared-vocabulary core, not a dependency chain.**
39 skills can "reach" more than 100 others transitively, and the two hubs
are the coordination meta-skill and the skill-about-skills. That is exactly
what you would expect from a library whose members talk *about* the same
system, and exactly what you would not expect from a build graph. Reaching
`multi-agent-coordination` in two hops carries almost no information; half
the catalog does.

**Closure-until-convergence is semantically meaningless for injection.**
This is why the graft rule is first-hop only. A closure walk that touches a
hub pulls in a median of 40 and up to 145 skills — indistinguishable from
not filtering at all. The code comment in `lib/skill-graft.ts` records the
decision: "Convergence closure was REJECTED on this data." One hop keeps
expansion proportional to what a skill *deliberately* points at, and
`HOP_DECAY` (0.5, on top of edge weight) keeps a hopped-to neighbor strictly
subordinate to a genuine direct match. The tests pin the behavior, including
the zero-edge degenerate case being byte-identical to no expansion
(`tests/unit/skill-graft.test.js`).

---

## 3. A composition algebra, read operadically

The operad lens (`skills/operad-task-decomposition/SKILL.md`) earns its keep
here in one specific way: it forces us to say, for each way skills combine,
*what the typed interface at the seam is*. Four combinators cover everything
we actually do:

**Sequential composition — output contract feeds input contract.** Skill A's
produce-kind is skill B's consume-kind, so `B ∘ A` is defined exactly when
the kinds match. This is the composition the `.windags` triple's node fields
were built for: node N's `output_contract` is the upstream half of node
N+1's `input_contract`, and the wave-by-wave executor already mutates those
fields when the DAG changes (a pruned node's downstream dependents "have
their `input_contract` updated to reflect its absence" —
`skills/wave-by-wave-parley/references/parley-protocol-rcp3.md`, step 5).
The operadic payoff is associativity: it does not matter whether the planner
decomposes task → (A, B∘C) or (A∘B, C) — delegation is safe as long as
types match at every boundary. That guarantee is what makes hierarchical
sub-DAGs sane, and it is also exactly what free-text contracts cannot
enforce today (§1's caveat).

**Parallel composition with shared context — the monoidal product.** Two
skills with no data dependency tensor: a wave runs both, and
`skills/agent-context-partitioner`-style planning is precisely "maximize
the tensor, sequence only what must sequence." The subtlety our runtime adds
that the textbook operad does not: parallel nodes here share *ambient
context* (repo state, the coordination blackboard), so the product is not
free — two skills that write to the same ambient surface interfere even
with no declared edge. That interference is a coordination problem
(`skills/multi-agent-coordination/SKILL.md`), not a type error, and the
formalism genuinely stops helping at this seam; we say so rather than
inventing a "monoidal product with side effects."

**Nesting — NOT-for boundaries as typed co-products.** When a skill's
decision tree hits its own declared boundary, it names a delegate:
`skill-architect` ends with "MCP server implementation →
`mcp-server-builder`; testing strategies → `test-architect`"
(`skills/skill-architect/SKILL.md`, NOT-FOR Boundaries). Read as types, a
well-partitioned domain is a co-product: the broad task-space splits into
disjoint summands, each owned by one skill, and the NOT-for clause is the
injection telling you which summand you are in. This reading is genuinely
useful because it gives us a *lint*: two skills whose NOT-for clauses point
at each other partition cleanly; two skills that both claim a region with
no boundary between them will double-activate. The olog lens
(`skills/olog-construction/SKILL.md`) adds one honest, small observation
here: `pairs-with` is not a functional arrow (a skill pairs with many), so
the composition graph is a span structure, not an olog — which is exactly
why we mine it statistically instead of validating it categorically. We
note this and stop; building the catalog's olog would be decoration until
some consumer needs path equivalences.

**Graft-time composition — an unordered monoidal product under a budget.**
The fleet's graft path (`lib/fleet-engine.ts` `appendSkillGraftContext`,
opt-in per ship via `skill_graft: true`) splices at most `topLimit` full
SKILL.md bodies — default 3, each hard-capped at 8,000 characters
(`DEFAULT_TOP_LIMIT` / `DEFAULT_MAX_BODY_CHARS`, `lib/skill-graft.ts`) —
into one prompt, a few KiB of doctrine per skill, time-boxed at 8 seconds
and fail-open so enrichment can never stall or fail a spawn. The product is
unordered: nothing sequences the three bodies, the agent reads all of them
as ambient doctrine. So what makes two skills compose well at graft time is
not type-matching but **non-interference**, and the best available language
for that is the priority/nullspace lens from
`skills/hierarchical-skills-representation/SKILL.md`: compose a subordinate
skill into the *nullspace* of the superior one — let it govern only the
decisions the primary skill leaves free — instead of mixing two doctrines
with implicit equal weight ("weighted-controller soup," that skill's named
failure mode). Concretely: a domain skill plus a *discipline* skill
(receipts, contracts, logging) graft well because the discipline constrains
dimensions the domain skill does not speak to; two domain skills with
overlapping vocabulary and different decision trees graft badly, and the
NOT-for co-product from the previous paragraph is the static predictor of
which case you are in. Every splice is now also an auditable fact rather
than silent prompt injection: one `pd.agent-harbor.skill-graft.v0` record
per fully-injected skill, with reason and outcome
(`schemas/agent-harbor/v0/skill-graft.schema.json`,
`lib/skill-graft-events.ts`, the `skill_grafts` table and `POST
/skills/graft` in
`docs/architecture/agent-harbor-technical-binder/09-data-model-and-api.md`).

Where we decline to push the formalism: operadic identities, equivariance,
and algebra-of-wiring-diagram theorems buy nothing at this catalog's
maturity. The two ideas that pay rent are *typed seams* (sequential) and
*declared boundaries as co-products* (nesting/graft interference). The rest
is vocabulary.

---

## 4. Compositions worth building, from this catalog

Concrete pairs and triples the graph data supports (or conspicuously fails
to support — flagged, because that gap is itself the finding). One-line
mechanism each; edge status from the 2026-08-19 scan.

1. **`windags-premortem` × `wave-by-wave-parley`** *(curated edge)* — the
   premortem's risk log keyed by `affected_nodes` is exactly the per-node
   risk severity the parley's `cfp` announcement already wants to carry
   (`skills/wave-by-wave-parley/references/parley-protocol-rcp3.md`, step 2); wire the produce to the
   consume and reconvention gets risk-priced bids for free.
2. **`semantic-conflict-prediction` × `wave-by-wave-parley`** *(no direct
   edge; nearest mined connection is three hops, through the
   `multi-agent-coordination` hub)* — a predicted
   symbol-claim collision is the highest-value trigger for an after-wave
   parley, and the economic gate formula (`P(fail)×waste > cost`, ported per
   the source audit's K4) decides *whether* convening beats proceeding.
   The missing direct edge is precisely what edge-aware suggestion should
   propose.
3. **`destructive-action-policy-matrix` × `human-gate-designer` ×
   `agent-work-receipt-designer`** *(curated wedge — the matrix declares
   both partners; the gate↔receipt seam itself carries no edge in either
   direction)* — approve-tier matrix rows name the nodes the gate designer
   builds review UX for, and a denial becomes a specialized work receipt;
   the matrix's own `pairs-with` reasons state both seams verbatim.
4. **`output-contract-enforcer` × `agent-work-receipt-designer`** *(curated
   edge)* — per-node output validation artifacts are literally in the
   receipt designer's declared `consumes: validation-artifacts`; node-level
   checking composes into task-level evidence with no new schema work.
5. **`agent-labor-pricing-function` × `cost-accrual-tracker` ×
   `cost-optimizer`** *(curated triangle with declared io-contracts)* —
   accrual telemetry supplies the cost floor, pricing sets the guardrails,
   the optimizer enforces them at runtime; the one genuine typed pipeline
   already latent in the catalog's frontmatter.
6. **`macaroon-capability-credentials` × `human-gate-designer`**
   *(graph-silent: zero in-links to macaroon, no curated edge either way)* —
   mint a gate approval as an attenuated macaroon (scope, TTL, budget
   caveats) so the approval is a checkable capability object instead of a
   boolean; the strongest composition in the catalog that the graph cannot
   currently see, and our standing example of why zero-degree ≠ low-value
   (70 skills share that blind spot).
7. **`context-economics-for-agent-swarms` × `episodic-memory-algorithms`**
   *(curated edge)* — the compaction budget decides which transient turns
   are worth promoting; the episodic store is where promotions land; the
   `pairs-with` reason already names the mechanism.
8. **`semantic-conflict-prediction` × `game-theoretic-agent-incentives`**
   *(curated edge)* — conflict prediction is only as good as the claims
   agents declare, and the incentive skill's whole job is making honest
   claiming the dominant strategy; a precondition composition, not a
   pipeline.

---

## 5. Implications

**For graft ranking [BUILT, this PR].** The first-hop expansion in
`lib/skill-graft.ts` is the composition graph's first consumer: a curated
edge or prose mention now widens the candidate pool by exactly one hop
after BM25+Tool2Vec fusion, with provenance (`via: 'first-hop'`,
`hopSeed`) on every boosted entry so ranking stays auditable, and injection
caps unchanged. The graph analysis above is the reason the policy is one
hop and not closure.

**For Snipe's suggestion job [DESIGNED].** Snipe (`fleet/ships/snipe.md`)
proposes at most one skill per PR, dispatched to `skill-architect` for
authoring. The composition graph gives Snipe a second, cheaper class of
proposal it does not make today: *edges*, not skills. When a PR's activity
touches two skills that compose (in the §4 sense) but share no edge —
composition 6 above is the canonical case — the right proposal is a
`pairs-with` edge with a stated reason, or a small bridging skill, not a
new 300-line SKILL.md. Two disciplines carry over from Snipe's existing
telos: dedup against NOT-for boundaries (never propose an edge between
skills whose descriptions explicitly exclude each other's domain — that
boundary is load-bearing, per §3's co-product reading), and the
one-considered-shot rule. The `pd seamanship outcomes` table
(`cli/commands/seamanship.ts`) is where accepted edge proposals would earn
or lose their keep.

**For skill I/O contracts as frontmatter [PROPOSED — designed here, not
built].** 166 skills already declare `metadata.io-contract` voluntarily.
The proposal: (a) freeze a small registry of produce/consume kinds from the
existing folksonomy rather than inventing one; (b) teach the catalog
scanner (`lib/shipwright/skill-index.ts`) to parse them; (c) add a
kind-match term to graft ranking — a candidate whose consume-kinds are
satisfied by an already-shortlisted skill's produce-kinds is a better
composition partner than co-mention alone can establish; (d) lint the
catalog for phantom kinds (produced by nobody, consumed by nobody). What we
are explicitly *not* proposing is runtime contract validation between
executing nodes — the source audit's RCP-13 marks that open, and it stays
open; frontmatter typing is design-time linting and ranking signal, nothing
more. If a validator ever ships, it starts from the node fields the
`.windags` triple already carries, not from a new schema.

**What we are not claiming.** The composition graph is mined from prose and
frontmatter, so its counts wobble with the parser; no contract in this
system is validated anywhere; and the operadic reading is a discipline for
naming seams, not a theorem about the catalog. The built artifacts are the
ranking expansion, its tests, and the graft audit trail. Everything else in
this document is a map of where typed composition is cheapest to buy next.
