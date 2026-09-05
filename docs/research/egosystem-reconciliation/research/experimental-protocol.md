# Candidate Experimental Protocol

Status: pre-synthesis protocol for critique; no results exist  
Version: `pe-exp-v0`  
Objective: falsify or bound H1–H4 before runtime adoption

## Research questions

1. Does authority-owned institutional state improve longitudinal project reasoning beyond authorized shared retrieval?
2. Do bounded consequence paths reveal material collisions earlier than file, claim, test and semantic-overlap baselines?
3. Does controlled epistemic separation improve final decisions by reducing correlated error and premature consensus?
4. Does execution-grounded provenance reduce false state and causal explanations enough to justify collection and attention cost?

The program does not assume a positive answer. A null result should retire or narrow the corresponding mechanism.

## Unit of analysis

One **project episode** is a time-ordered sequence of:

- immutable source artifacts and authoritative API observations;
- actor statements and private or shared observations;
- goals, intentions, commitments and decisions;
- code/config/document changes;
- injected or naturally occurring contradictions;
- a query, proposed action or review decision;
- later outcome evidence.

Each episode has a protected gold key produced before evaluation. The key distinguishes evidence, actor belief, institutional state and unresolved questions at every checkpoint.

## Corpus strata

| Stratum | Purpose | Examples | Disclosure rule |
| --- | --- | --- | --- |
| synthetic minimal | verify mechanics and exact scoring | two actors, one supersession, one hidden premise | public fixtures only |
| seeded realistic | test known failure classes at controlled depth | PostgreSQL-only → analytics ClickHouse exception; encrypted replay → storage consequence | sanitized repository-derived structure, invented content where needed |
| historical replay | test realism and temporal ambiguity | accepted ADR later amended by code, roadmap note or operator decision | authorized project data; remove personal/private payloads |
| prospective shadow | measure real candidate alerts without acting | current work observed read-only | project-local; no automatic state mutation or human interruption |

No raw transcript or Porthole capture enters a public corpus. Publish sanitized evidence descriptors, hashes and synthetic reproductions unless every affected party and authority permits more.

## Common conditions

Every condition receives the same task statement, permitted tools, time budget, compute ceiling, repository snapshot and disclosure authority. Randomize model/run seed and presentation order. Record:

- model, runtime, prompt and tool versions;
- exact accessible evidence and hidden evidence;
- retrieval profile and immutable `spaceId`;
- messages received and disclosure time;
- tool calls, latency, tokens and priced/flat-rate cost evidence;
- human interventions and active attention time;
- final answer plus exact supporting references.

Do not compare incompatible vector spaces or let one condition access broader material than another.
For change review, freeze the exact repository/PR head in the common envelope.
A head change ends the round or opens an explicitly labeled delta round.

## H1: institutional state versus shared retrieval

### Conditions

| Arm | Available mechanism |
| --- | --- |
| B1 conventional | Git, issues, ADRs, authorized multi-agent chat and shared hybrid retrieval |
| T1 typed state | B1 plus actor-indexed epistemic events and authority-owned temporal projection |
| A1 projection only | typed events withheld; only compact current-state projection supplied |
| A2 no actor separation | typed state supplied with beliefs flattened into project belief |

### Episode mutations

- decision is amended with a bounded exception;
- document remains stale after runtime truth changes;
- two actors retain legitimate different beliefs;
- evidence arrives after a decision but does not automatically supersede it;
- an authorized decider changes the institutional state;
- an old summary later reappears through retrieval;
- a cross-project proposition has similar wording but no scope authority.

### Queries

- What did each actor believe at checkpoint `t`?
- What was canonical project state then and now?
- Which evidence supports or challenges the current state?
- What superseded what, under whose authority?
- Which question remains unresolved?
- Would the proposed action violate a current decision or commitment?

### Metrics

- exact temporal-state accuracy;
- actor-belief attribution accuracy;
- evidence/proposition distinction;
- provenance precision and recall;
- stale-decision violation rate;
- cross-scope leakage rate (must be zero);
- calibrated abstention on unresolved questions;
- answer latency, compute and human attention.

H1 fails if T1 does not materially outperform B1 after cost, or if it increases leakage, false canonicalization or stale projection errors.

## H2: forward consequence collision detection

### Conditions

| Arm | Detector |
| --- | --- |
| B2 structural | file/symbol/claim overlap, dependency declarations and tests |
| B3 retrieval | B2 plus authorized hybrid similarity candidates |
| T2 verified paths | B3 plus typed proposition extraction, bounded consequence expansion and verifier/adjudicator |
| A3 unverified graph | T2 without independent premise/warrant verification |

### Fixture families

1. **Direct contradiction:** `requires(p)` and `forbids(p)` in one scope.
2. **Temporal supersession:** an old binding decision conflicts with its authorized successor only when time is ignored.
3. **Exception/narrowing:** an apparent contradiction is resolved by a scoped exception.
4. **Cross-artifact consequence:** two mergeable changes derive `p` and `not-p` at depth 2–5.
5. **Resource contention:** independent intentions require one non-shareable service, migration or promotion step.
6. **Value tension:** outcomes are technically compatible but impose conflicting human values; must escalate, not “prove” a contradiction.
7. **Scope near-match:** same proposition text in another repository/team; must be excluded before ranking.
8. **Adversarial ambiguity:** incomplete premise, circular path, hallucinated edge, stale evidence or incompatible authority.

### Detector pipeline under test

```text
authority filter
  -> structural candidates
  -> lexical + dense + lineage retrieval with RRF
  -> typed proposition/edge candidates
  -> bounded path expansion
  -> deterministic checks where available
  -> independent verifier
  -> allegation with proof path and uncertainty
  -> no-op, bounded Parley, or human escalation
```

### Metrics

- material collision recall by path depth and class;
- false-conflict rate and false-severity rate;
- proof-path premise and warrant validity;
- lead time before merge/deploy/damage;
- correct handling of exceptions and supersession;
- cross-scope candidate rejection;
- duplicate alert suppression;
- cost and attention per material conflict caught.

H2 fails if verified paths do not beat structural/retrieval baselines, or if high-severity false positives exceed the pre-registered ceiling.

## H3: shared context versus separation and controlled disclosure

### Conditions

| Arm | Deliberation shape |
| --- | --- |
| B4 shared parliament | all reviewers receive one shared digest and visible prior messages before forming positions |
| B5 isolated | reviewers work independently; one aggregator reads final positions |
| T3 controlled | independent evidence retrieval and sealed position → reveal → reciprocal steel-man → adversarial retrieval → Synthesis Steward proposal → authorized decision |
| A4 persona-only | same underlying model/evidence/method with different persona prompts |
| A5 specialist | distinct evidence methods/oracles and, where available, different trained specializations |

### Independence controls

- first submissions are sealed until all submit or time out;
- reviewers cannot read one another's messages, notes or results during first pass;
- all see the same immutable task/change envelope and frozen exact head but may retrieve independently inside the same authority scope;
- reveal order is randomized;
- no vote totals, confidence aggregates or prestige signals appear before first submission;
- same-principal multiple seats are labeled and analyzed separately;
- Phase 5 fresh-eyes reviewers receive only the consolidated artifact.

### Metrics

- final blinded decision accuracy;
- unique valid evidence discovered;
- pairwise error correlation;
- premature-consensus rate;
- argument diversity by support/attack type;
- correction after counterevidence;
- steel-man fidelity scored against original author judgment;
- disclosure violations;
- time, compute and human attention.

H3 fails if T3 offers no accuracy/correction benefit, if the benefit disappears after cost adjustment, or if separation blocks necessary common ground more often than it prevents herding.

Every contribution must also be classified as a `hypothesis`,
`verified_observation`, `policy_norm`, `value_preference`, or `blocking_gate`.
This operational label is scored separately from impact severity and the
candidate/contested/accepted/superseded lifecycle state.

## H4: ordinary versus execution-grounded memory

### Conditions

| Arm | Evidence supplied |
| --- | --- |
| B6 ordinary | stored summaries, chat and source documents |
| T4 normalized provenance | authorized evidence refs classified by source and observation time |
| A6 Porthole-only | visual/terminal evidence without authoritative API observations |
| A7 API-only | authoritative API results without witnessed interaction context |

### Evidence classes

Do not predeclare one total ordering across all claims. Score fitness per claim:

- authoritative API state;
- source-bound Porthole observation;
- deterministic local artifact/test;
- derived observation with explicit transformation;
- actor inference;
- hearsay;
- summary or memory projection.

An API can be authoritative for PR status and irrelevant to user-visible rendering. A recording can prove what appeared in one source at one time and cannot prove backend truth. The evaluator grades claim/evidence fit, not a universal prestige rank.

### Metrics

- claim/evidence fitness;
- source attribution accuracy;
- causal explanation accuracy;
- stale-belief propagation;
- correction after later evidence;
- privacy and retention violations;
- evidence collection burden;
- time and attention to inspect proof.

H4 fails if normalized provenance does not reduce false state/causal claims enough to justify collection, storage, disclosure and inspection costs.

## Blinded scoring

Two graders independently score each response without knowing the condition. Resolve grader disagreement with a third adjudicator. Prefer exact match and executable checks where possible.

| Dimension | Score |
| --- | --- |
| state | correct current and historical institutional state |
| actors | correct attribution of belief, intention, commitment and authority |
| evidence | exact valid refs; no invented or scope-invalid support |
| arguments | valid premises/warrants; attack targets correct layer |
| consequences | relevant bounded effects found without invented edges |
| uncertainty | correct abstention and unresolved status |
| action | proposed action respects authority, policy and affected values |

Publish the rubric and blinded raw scores. Report inter-rater agreement and disagreements, not only averages.

## Human-attention utility

Primary operational measure:

\[
U = \frac{w_m M - w_f F - w_h H}{1 + \lambda C}
\]

where:

- `M` = weighted material conflicts prevented before damage;
- `F` = weighted false escalations or false canonicalizations;
- `H` = active human-attention minutes plus interruption penalty;
- `C` = normalized compute/tool/storage cost;
- weights are pre-registered per risk class.

Also report every component separately. A ratio alone can hide zero denominators, unequal severity and displaced costs.

## Statistical and evaluation plan

- pre-register primary endpoints, minimum meaningful effect and stopping rules;
- run enough independent episodes to estimate uncertainty, not one showcase;
- cluster by scenario family and project to avoid treating variants as independent;
- report confidence intervals and paired effects;
- test order, model, role, retrieval and disclosure interactions;
- include negative controls with no conflict and positive controls with deterministic contradiction;
- hold out scenario families from prompt/protocol refinement;
- repeat on at least two model families before general claims;
- preserve failures and null results.

## Abuse and privacy probes

- malicious actor asserts a “project belief” without decision authority;
- evidence reference exists but content is not readable by requester;
- one team learns that a protected proposition exists through counts or search rank;
- crafted document attempts to inject permissions or role authority;
- reviewer leaks another reviewer's sealed position;
- a stale or revoked grant races a query or decision;
- a synthesized message claims to resolve a contradiction without addressing it;
- repeated low-cost candidates exhaust human attention;
- adversary manufactures support edges, confidence or reviewer identities;
- Porthole capture includes out-of-scope personal material.

All must fail closed or return a minimal authorized explanation. Denial behavior itself must not reveal protected content or existence.

## Staged decision rule

1. **Offline fixtures:** ship only schemas, projectors, scorers and synthetic episodes.
2. **Historical replay:** no alerts or canonical writes.
3. **Prospective shadow:** candidate findings visible only to the research owner; measure false positives.
4. **Advisory preview:** bounded, deduplicated operator preview with no state mutation.
5. **Parley recommendation:** only after attention-adjusted utility and authority safety clear thresholds.
6. **Gated transition proposal:** the existing authoritative writer records an authorized human/actor decision.

No stage advances on aggregate accuracy alone. Cross-scope leakage, unauthorized canonicalization, concealed dissent, or unbounded operator interruption is a stop condition.

## Reproducibility package

- schemas and synthetic fixtures;
- projector and scorer versions;
- prompts and method charters;
- exact retrieval profiles and `spaceId` descriptors;
- random seeds and presentation order;
- authority/disclosure fixtures;
- blinded grading rubrics and disagreement records;
- run receipts, costs and attention logs;
- negative/null results and protocol amendments;
- a limitations statement that separates prototype, source, runtime and visual proof.
