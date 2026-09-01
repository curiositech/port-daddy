# 22 Orchestration Surface: DAG Visualization, Execution Opinions, Adversarial Review, Output Evaluation

Status: architecture chapter. This chapter realizes the deferred design work
order named in `docs/strategy/2026-07-06-distribution-dogfood-and-go-to-market.md` <!-- cite-exempt: strategy doc lives on the strategy/distribution-and-dogfood branch (PR #707), not yet shipped to main -->
§13/§14 ("the orchestration-visualization surface"). It is contract-first and
target-state; nothing here is shipped until the proof gates below pass.

Skill lenses grafted for this chapter, per the chapter 19 rule that a chain
starting without its grafts is under-prepared: `dag-runtime`,
`jury_rig-architect`, `dag-quality`, `skill-grader`, `reactflow-expert`,
`agentic-coding-ux-designer`, `architecture-binder-of-record`.

## The concept

Multi-agent orchestration must be **visible and opinionated**, not a black box.

This is not a speculative feature. It is the exact working loop that built
Agent Harbor itself: a workflow decomposes intent into a DAG of agents, an
integration reviewer (work order I0, chapter 18) adversarially verifies every
chain's output before merge, and graded evidence decides what ships. The binder
corpus is the receipt — chapters 08, 11, and 15 are three successive
adversarial passes over this very document set. Chapter 22 productizes that
discipline so an operator gets, for every coordinated run, what the Port Daddy
build got for itself.

Four capabilities, one surface story:

1. **Plan visualization.** The planned execution graph — waves, dependencies,
   which seamanship grafts onto which node — rendered before it runs, and
   steerable.
2. **Execution opinions.** Not just "here is the DAG" but "here is *why*
   parallel here, serial there, a human gate at this node, this topology over
   that one" — so the operator can overrule with understanding, not faith.
3. **Automated adversarial review.** Every coordinated run gets an I0-style
   verification pass: independent skeptics that try to refute the output
   before it is accepted.
4. **Agentic output evaluation.** Outputs scored against schemas and quality
   criteria, hallucination checked, iterate-or-stop decided honestly, with the
   scores feeding the ratings/guild layer.

The stack is the visible form of the product's core claim — accountability —
and the multi-agent-coordination wedge made tangible. A Work Receipt says what
an agent did; the orchestration surface says what the *plan* was, why it had
that shape, who tried to break the result, and what grade it earned.

## Vocabulary

Chapter 19 already names the operator-visible artifact of Navigation "the
chart." This chapter adopts that: the rendered, steerable plan graph is **the
Chart**. The other three capabilities keep plain names — opinions, adversarial
review, evaluation — until the operator blesses harbor names; naming is not
this chapter's decision to force.

The vocabulary-collapse rule from chapters 14 and 19 binds here with extra
force, because this chapter's engines are the most name-laden in the corpus:
`Jury-rig`, `next-move`, `dag-runtime`, `dag-quality`, `skill-grader`, wave
planners, Thompson samplers, and meta-DAGs are engine and implementation
names. The operator sees the Chart, the plan's reasons, the review verdicts,
and the grades. No operator-facing surface, doc, or command mentions the
engine names (chapter 19 gate, extended verbatim to this surface).

## Where it lives: triad placement, hub-and-spoke, no new surface

The strategy's hub/spoke principle (§9) and the sanctioned-surface rule apply
unchanged: **the daemon is the hub; orchestration state is daemon truth; every
rendering is a spoke.** This chapter adds *no new surface*. It adds a
projection and its renderings:

| Surface | What it renders | What it may do |
| --- | --- | --- |
| Fleet Control Center (FleetBar's deep window; the `/fleet-ui/` content) | the full steerable Chart: ReactFlow-class graph, opinion cards, review findings board, evaluation history | edit the plan pre-approval, overrule opinions, waive findings — all as durable commands |
| pd-console | a native Chart pane conjoined with roster/detail: the plan graph with per-node transcript deep-links, review findings inline with the diff they indict | same command set as Control Center; plus transcript-adjacent inspection |
| FleetBar popover | only the gates the orchestration produces: "team proposal awaiting consent (est. $2.10)", "skeptic refuted the output — review?", "evaluation stalled at 0.62 — iterate or accept?" | approve/deny/modify; deep-link to Control Center or pd-console for anything wider than one card |
| Scout | nothing new | a Scout intent that navigates into a multi-node plan deep-links to the Chart like any other |
| CLI | `pd plan show <intent>` as box-glyph waves with chapter 20 CLI grammar; `--json` emits the raw WorkPlan | scripting and emergency parity, not the primary steering surface |

Placement rules, per the chapter 19 division of labor and the
`agentic-coding-ux-designer` boundary that review must sit at decision points,
not after the damage:

1. The consent moment is *before materialization*. The Chart renders from the
   `WorkPlan` while the plan is in `approval-required`; cost appears on the
   consent card (chapter 20 honesty law 11) as the summed node budget, not as
   ambient anxiety afterwards.
2. Anything requiring more than one screen of evidence — reading findings
   against diffs, comparing iterations — belongs in Control Center or
   pd-console. FleetBar deep-links; it never grows panes (chapter 19).
3. No surface owns orchestration state. The Chart is a projection of ledger
   truth; killing the daemon degrades every rendering to the same honest
   disconnected state (IT-017 applies to this projection too).

## Capability 1: the Chart — plan visualization and steering

**The source of truth already exists.** The frozen F0 `WorkPlan` v0 schema
(`schemas/agent-harbor/v0/work-plan.schema.json`) carries everything a first
Chart needs: `nodeSpecs[]` with `dependencies`, `skillGrafts` (Seamanship,
visible per chapter 19's rule that a plan whose nodes name no skills is a
placeholder), `scope`, `contracts` (budgets, stop conditions), `acceptance`,
and per-plan `shape`, `evidence`, and `splitEvidence`. Waves are not stored;
they are **derived** by topological layering over `dependencies` at render
time — storing them would invite drift between stored waves and edge truth
(the `jury_rig-architect` wave-planning failure mode: wave assignments that
violate the topological order deadlock the scheduler; derive, then validate
with Kahn's algorithm before any run starts).

Rendering contract (per `reactflow-expert`, binding for the web rendering and
advisory for the GPUI pane):

- ReactFlow v12 custom nodes + ELKjs auto-layout; `layered` algorithm below
  ~100 nodes, direction chosen by viewport aspect; layout re-runs **only on
  topology change**, never on node-state updates — live state flows as
  data-only updates so the Chart does not thrash while agents work.
- Live state rides the hot bus (chapter 19): the Chart subscribes to plan-
  scoped topics on the one multiplexed loopback WebSocket; per-node status,
  current step, spend ticks, and wave advancement are hot-bus deltas. Plan
  mutations, approvals, and completions are cool-bus events. Hot messages may
  move the Chart quickly; durable events decide history.
- Node cards render chapter 20 grammar: layer-hued state stripes, micro-flags
  through `lib/maritime-signals.ts` only (F=awaiting-human on gate nodes,
  H=claim-active, D=blocked, B=burning-cash on budget breach), pulse rings
  only while in flight, `prefers-reduced-motion` freezes to a still. State is
  never color alone.
- Interactive affordances on nodes (pause, inspect, overrule) follow the
  `reactflow-expert` interaction rules; every control on a node maps to an
  existing `ControlCommand` kind — the Chart never renders a control the
  daemon cannot enforce (chapter 00 criterion 6).

**Steering.** Pre-approval, the operator may edit the plan: reorder, merge,
split, drop, or re-skill nodes; add or remove a human gate; tighten a budget.
Each edit is a durable `PlanRevision` event (new contract, below) against the
plan, and the plan re-validates (acyclicity, dependency sanity, budget sums)
before returning to `approval-required`. Mid-run, steering narrows to the
mutations the runtime can honor safely — retry-with-different-skill, insert a
gate, cancel a subtree — expressed through the same revision contract, with
the `jury_rig-architect` mutation-depth limit (max 3 revisions per run without
an operator gate) preventing mutation storms. Placeholder-bearing plans
(chapter 14 Planning Placeholders) render as a hypertree: resolved nodes
concrete, placeholders visibly hollow with their `resolveBy` condition on the
card — the Chart must never render a placeholder as if an agent exists.

## Capability 2: opinions — the plan argues its choices

The `WorkPlan` v0 schema already requires the seed: `evidence` ("why the
planner chose this shape") and the six-signal `splitEvidence` vector
(coupling, graph width, context pressure, skill boundary, failure domain,
review independence, plus split economics). Chapter 14's default policy — one
node unless the planner can write down why — *is* an opinion contract. This
capability extends it from one plan-level paragraph to per-decision records.

An **opinion** is attached to every decision the navigator made that an
operator could reasonably reverse:

| Decision kind | Example rendered opinion |
| --- | --- |
| `parallelize` | "research and scaffold share no files and no symbols (coupling: none); running them serially adds ~14 min for zero conflict reduction" |
| `serialize` | "both nodes write `lib/ipc-router.ts`; the conflict forecaster rates overlap high — serial with a claim handoff beats a parley mid-run" |
| `human-gate` | "this node force-pushes to a shared branch; destructive-action policy requires consent (C5), estimated blast radius: 3 open PRs" |
| `topology` | "chain over dag-workgroup: review independence is low — each step consumes the previous diff, so parallel drafts would merge-conflict by construction" |
| `skill-graft` | "grafted `postgres-explain-analyzer` over the generic SQL skill: the intent names query latency, and outcome attribution favors it 7:2 on this repo" |
| `model-tier` | "strong tier on the decision node, fast tier on the mechanical rename: paying for reasoning where a wrong choice cascades" |
| `budget` / `stop` | "node budget $0.40, stop on 3 consecutive schema-invalid outputs: this skill's historical retry curve flattens after 3" |

The generators behind these are the `jury_rig-architect` decision trees
(execution mode, architecture pattern, commitment level, circuit-breaker
configuration) running inside the WorkPlanner — engine detail the operator
never sees. What the operator sees is the argument and the counterfactual.

Rules:

1. Every opinion names its evidence and its counterfactual ("what serial
   would cost here"). An opinion without a counterfactual is an assertion,
   and renders as low-confidence.
2. **Overrule is a first-class durable decision**, not a plan edit that
   forgets its reason. The operator's overrule records which opinion was
   rejected and optionally why; it rides the same `PlanRevision` contract
   with `overrules: <opinionId>`. The receipt carries it (buyers of a leased
   automation see where a human disagreed with the navigator).
3. Overrules are training signal. They flow to the same outcome-attribution
   store that Seamanship's search cascade reads (chapter 19), so a navigator
   that keeps proposing a topology the operator keeps rejecting loses
   confidence in that pattern. This is the pattern-learning loop, fed by
   disagreement instead of only success.
4. Opinions are rendered at the consent moment on the Chart (a card per
   contested decision, collapsed by default), never as a wall of
   self-justification. The `agentic-coding-ux-designer` rule applies: show
   intent before action — model, scope, tools, budget, stop condition — and
   make review cheap.

## Capability 3: automated adversarial review

Chapter 18's I0 integration reviewer and chapters 08/11/15 prove the pattern
manually: independent skeptics, findings with severity, verify-then-merge.
This capability makes it a runtime stage instead of a documentation ritual.

Mechanics:

- The WorkPlanner appends a **review stage** to any plan whose shape is wider
  than single-node, and to single-node plans whose contracts mark the output
  load-bearing (`acceptance.doneWhen` present, PR-bound, or receipt-leased).
  Reviewers are ordinary `nodeSpecs` with `kind: "reviewer"` (already in the
  v0 schema) — they materialize as Agent Nodes under the same Articles,
  budgets, and transcripts as workers. No shadow machinery.
- Skeptic independence is structural, not aspirational: a reviewer node never
  shares a body, session, or context window with the node it reviews
  (`dag-runtime` context-isolation rule — a reviewer that saw the worker's
  conversation is contaminated), and its grafts are review skills
  (`redteam-review`, `code-review-checklist`, domain skeptics), not the
  worker's build skills.
- The skeptic's brief is refutation: attack the claim, not restate it. Its
  output is a set of **ReviewFindings** (contract below) with verdicts:
  `CONFIRMED` (reproduced/evidenced), `PLAUSIBLE` (argued, unreproduced), or
  `REFUTED-BY-REVIEW` (the skeptic's own claim died under counter-evidence).
- Findings gate acceptance. The plan's `review-ready` state (already in the
  v0 state machine) resolves only when every finding at or above the plan's
  severity threshold is fixed, refuted, or **operator-waived** — a waiver is
  a durable decision on the receipt, exactly like an overrule. Silence is
  not acceptance.
- **Review economics are explicit.** Adversarial review costs real money, so
  the trigger is the `jury_rig-architect` ceiling rule, stated as product
  policy: run the expensive skeptic pass when
  `failureProbability × downstreamWaste > reviewCost`; below that line, the
  cheap evaluation of capability 4 suffices. The threshold is a plan
  contract the operator can see and change, not a hidden heuristic.

What the operator sees: a findings board (Control Center / pd-console) where
each finding pins to the artifact it indicts — a diff hunk, a receipt claim,
a schema violation — with its verdict chip and its disposition. On the Chart,
a plan blocked in review flies Victor (conflict) or Foxtrot (awaiting-human)
per the maritime-signals referee, never a hand-picked letter.

No competitor ships this. It is the productized form of the loop that built
the product, and the receipt is the proof: a Work Receipt whose `validation`
section carries skeptic verdicts is a stronger trust object than any
self-report (chapter 00's Work Receipt promise, upgraded).

## Capability 4: agentic output evaluation

Every node output passes the `dag-quality` pipeline before downstream nodes
consume it — this is the quality gate *between* nodes, distinct from the
skeptic pass that gates *final* acceptance:

1. **Schema validation** — output matches the node's declared contract
   (required fields, types, constraints). Fail → reject with specific errors
   and retry with a schema reminder (`dag-runtime` failure-escalation ladder,
   max 2 schema retries).
2. **Content validation** — non-filler, internally consistent, referenced
   files/URLs/identifiers actually exist.
3. **Confidence scoring** — weighted evaluator signals per `dag-quality`:
   self-evaluation (low weight, sycophancy-biased), peer judge, downstream
   usability report, human signal at gates as gold standard. Weights
   normalize over available signals; a score built only on self-evaluation
   renders as such.
4. **Hallucination detection** — citation verification, entity existence,
   confidence calibration against expected uncertainty. A fabricated
   reference is a `CONFIRMED` finding, not a style note.
5. **Iterate-or-stop** — the `dag-quality` thresholds as product defaults:
   accept ≥ 0.8; iterate with feedback below that while iterations remain;
   escalate to a human gate at < 0.5 after max iterations, or immediately at
   < 0.3 first-attempt (fundamentally wrong beats politely retried).
   Convergence monitoring stops the loop honestly: plateau (2+ flat
   iterations) accepts the best; degradation reverts to the best; oscillation
   halts and reports that the feedback itself is contradictory.

**Feedback delivery reuses M5.** Iteration feedback — structured issues,
strengths to preserve, iteration guidance — is injected at the node's next
turn through the signed `GuidanceEnvelope` (ADR-0096, frozen v0), with
`kind: evaluation-feedback` as a registered guidance kind. No new injection
channel; evaluation guidance is exactly as authenticated, witnessed, and
replay-protected as operator steering, and the forged-guidance probe covers
it for free.

**Evaluation feeds the guild.** Scores, iteration counts, convergence shapes,
and finding rates accrue to the skills and node patterns that produced them —
the same outcome-attribution store Seamanship reads, and the substrate the
strategy's ratings/guild layer (§4) prices against. The rubric discipline is
`skill-grader`'s: grades match rubric criteria literally, no grade inflation,
phantom evidence scores as the defect it is. One machinery grades a
marketplace skill and grades a run, because a run *is* a skill's field trial.

## Contracts

Reuse-first, per F0. Existing v0 schemas carry most of this chapter:

| Existing contract | What this chapter reads/writes |
| --- | --- |
| `work-intent.schema.json` | the Chart's root: goal, constraints, source |
| `work-plan.schema.json` | nodeSpecs, dependencies, skillGrafts, shape, evidence, splitEvidence; states `approval-required`, `running`, `replanning`, `review-ready`, `receipt-sealing` are the Chart's lifecycle spine |
| `guidance-envelope.schema.json` (ADR-0096) | evaluation feedback and mid-run steering injection, signed |
| `control-command.schema.json` | every Chart affordance maps to a command kind |
| `skill-graft.schema.json` | per-node Seamanship shown on the Chart and the receipt, with `outcome` closing the attribution loop |
| `work-receipt.schema.json` | `validation`, `risks`, `verificationStatus` carry skeptic verdicts, waivers, overrules, and final grades |
| `cost-accrual-event.schema.json` | per-node spend ticks on the Chart; review-stage cost on the consent card |

Four new v0 schemas are proposed (additive; nothing existing changes shape):

| Proposed contract | Required fields (sketch) | Purpose |
| --- | --- | --- |
| `plan-opinion` | `opinionId`, `planId`, `decisionKind` (parallelize / serialize / human-gate / topology / skill-graft / model-tier / budget-stop), `subject` (nodeSpecIds/edge), `argument`, `counterfactual`, `confidence`, `evidenceRefs[]` | the navigator's argued choice, renderable and overrulable |
| `plan-revision` | `revisionId`, `planId`, `actor` (operator/planner/runtime), `mutation` (typed: add/remove/reorder/re-skill/re-tier/insert-gate/cancel-subtree), `overrules?` (opinionId), `reason?`, `resultingState` | durable steering; the overrule record; mutation-depth accounting |
| `review-finding` | `findingId`, `planId`, `reviewerNodeId`, `subjectRef` (artifact/diff/claim), `severity`, `claim`, `evidence`, `verdict` (CONFIRMED / PLAUSIBLE / REFUTED-BY-REVIEW), `disposition` (open / fixed / refuted / waived), `waiver?` (operator, reason) | the skeptic's unit of work; gates `review-ready` |
| `evaluation-record` | `evalId`, `planId`, `nodeSpecId`, `runId`, `iteration`, `schemaValid`, `scores` (per-evaluator + weighted), `hallucinationFlags[]`, `decision` (accept / iterate / escalate / revert), `feedbackEnvelopeId?`, `convergence` (improving / plateau / degrading / oscillating) | the quality gate's ledger entry; the guild's raw material |

All four are cool-bus objects: append-only, attributable, replayable (chapter
09 discipline). The Chart's animation is hot-bus and owns none of them.

## Proof gates

Continuing the integration-test numbering from IT-018 (chapter 19):

### IT-019 Chart Legibility

Fixture: submit a Work Intent that navigates into a dag-workgroup of ≥ 5
nodes with dependencies.

Verify: the Chart renders before materialization in `approval-required`;
derived waves match a valid topological order (Kahn-validated); every node
card names its grafted skills, budget, and stop conditions; the same skills
appear later on the sealed receipt; total estimated cost appears on the
consent card and nowhere ambient; killing the daemon mid-render degrades the
Chart to the honest disconnected state; no engine name appears anywhere in
the rendering.

### IT-020 Opinionated Overrule

Fixture: a plan where the navigator chose parallel execution for two nodes;
the operator disagrees and serializes them.

Verify: the parallelize opinion renders with argument and counterfactual; the
overrule lands as a durable `plan-revision` with `overrules` set; the plan
re-validates and re-renders serially; the sealed receipt records the overrule;
the outcome-attribution store shows the rejection signal; a fourth mid-run
mutation on the same plan is refused pending an operator gate
(mutation-depth limit).

### IT-021 Skeptic Refutation

Fixture: a worker node produces output with a seeded defect (a fabricated
citation and a claim its own diff contradicts); the plan crosses the review-
economics threshold.

Verify: reviewer nodes materialize with no shared session/context with the
worker; the fabricated citation lands as a `CONFIRMED` finding pinned to the
artifact; the plan blocks in `review-ready` and the Chart flies the referee-
mapped flag; acceptance is impossible until the finding is fixed or operator-
waived; a waiver appears on the receipt as a durable decision; a control run
below the economics threshold skips the skeptic pass and says so on the plan.

### IT-022 Evaluation Loop Honesty

Fixture: a node whose first output fails its schema, whose second scores
0.65, and whose third plateaus.

Verify: the schema failure retries with a specific reminder, not a blind
rerun; iteration feedback arrives via a signed `GuidanceEnvelope` of kind
`evaluation-feedback` and appears in the transcript as witnessed guidance;
the convergence monitor stops at the plateau and accepts the best iteration
rather than burning the remaining budget; every iteration leaves an
`evaluation-record`; the record's scores attribute to the node's grafted
skills; a forged feedback envelope is rejected by the M5 verifier and the
rejection is witnessed.

## Relationship to earlier chapters

- **Chapter 14** owns intake and shaping; this chapter renders and argues
  what the WorkPlanner decided, and gives overrules a contract. The default-
  one-node policy is unchanged — a single-node plan gets a one-card Chart and
  no ceremony.
- **Chapter 19** owns the triad and the buses. The Chart is a projection
  rendered per its rules: hot bus for motion, cool bus for history, FleetBar
  for gates only, deep evidence in Control Center/pd-console. Navigation and
  Seamanship vocabulary binds; this chapter names Navigation's chart as a
  rendered surface.
- **Chapter 12 / work order I0 (chapter 18)** are the manual ancestors of
  capability 3; chapters 08, 11, and 15 are its dogfood provenance. When
  IT-021 passes, the binder's own review discipline has become a runtime
  feature.
- **Chapter 20** owns every pixel rule the Chart obeys: story hues as
  accents, one color zone per view, state never color alone, flags only
  through `lib/maritime-signals.ts`, honesty laws 11–14 for cost/empty/
  truth-chip/unknown rendering.
- **Chapter 04** owns skills and grafting; this chapter closes the loop by
  feeding evaluation outcomes and overrules back into outcome attribution.
- **Chapter 09** owns the ledger discipline the four new contracts follow;
  **chapter 03** owns the GuidanceEnvelope channel capability 4 reuses.
- **Chapter 16**: contradictions between this chapter and 14/19/20 go to the
  Architect of Record; per `architecture-binder-of-record`, every capability
  claimed here is target-state until it carries an owner, its IT gate, and an
  evidence link — this chapter ships with gates named and evidence
  deliberately absent.

## Open questions (honest)

1. **Which steerable renderer ships first?** A ReactFlow editor in the
   Control Center webview is the fast path; a GPUI-native Chart pane in
   pd-console is the durable one. Building both editors doubles interaction
   code for the hardest widget in the product. Position leaning: read-only
   Chart in both early, *editing* in Control Center first, pd-console
   editing after M9's editor investment — but this is a sequencing call the
   operator should make against the M-waves.
2. **Skeptic economics calibration.** The `failureProbability ×
   downstreamWaste > reviewCost` trigger needs real priors we do not have
   yet. Until attribution data accumulates, the threshold is a guess wearing
   a formula. Ship it visible and conservative, and say so on the plan card.
3. **Who grades the graders?** Peer evaluators drift, self-evaluation is
   sycophantic, and skeptics can be lazy (rubber-stamp `PLAUSIBLE`
   everything). The counter is spot-check gates: a small sample of accepted
   runs re-reviewed at strong tier or by the operator, with evaluator
   disagreement itself scored. Unbuilt; needs its own contract.
4. **Guild coupling.** Evaluation scores feeding public ratings (§4) before
   calibration exists could poison the marketplace with confident noise.
   Position: scores stay harbor-local until the spot-check machinery of (3)
   exists; publishing uncalibrated grades is coverage theater.
5. **Hypertree rendering depth.** Placeholder-heavy plans (chapter 14) can
   nest: a placeholder resolves into a sub-plan with its own placeholders.
   How many levels does the Chart render before it becomes noise, and does a
   sub-plan get its own Chart or an inline expansion? Needs a design pass
   with real plans, not a rule invented here.
6. **Mid-run steering limits per body.** A C4+ body honors pause/cancel/
   re-gate cleanly; a C1 advisory body cannot. The Chart must render steering
   affordances per compliance level (disabled controls with the honest
   reason), and the exact affordance matrix per level is unspecified.
7. **Windows.** Like everything native, the Chart's pd-console pane is
   Mac-first; the Control Center webview rendering is the platform-neutral
   path and should be treated as the Windows-track default (strategy §9).
