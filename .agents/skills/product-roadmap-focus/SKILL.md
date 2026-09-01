---
license: FSL-1.1-MIT
name: product-roadmap-focus
description: "Chooses the most important product or roadmap work under ADHD, founder, budget, and multi-agent constraints. Use when asking what to work on next, prioritizing a roadmap, cutting scope, choosing an MVP slice, or deciding whether to split work across agents. NOT for executing an already-chosen task, generic project status reporting, personal financial advice, or long unbounded brainstorming."
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Product & Strategy
  tags:
    - product-focus
    - roadmap
    - prioritization
    - adhd
    - founder
    - agent-coordination
  pairs-with:
    - skill: project-management-guru-adhd
      reason: Converts selected roadmap work into ADHD-friendly chunks and reminders.
    - skill: tech-entrepreneur-coach-adhd
      reason: Applies MVP, money, and scope tests before building.
    - skill: cqrs-event-sourcing-architect
      reason: Records roadmap decisions as append-only events and projections.
  provenance:
    kind: first-party
    owners: [port-daddy]
  mirrors:
    repo: skills/product-roadmap-focus
    codex: .codex/skills/product-roadmap-focus
    claude: .claude/skills/product-roadmap-focus
    agents: .agents/skills/product-roadmap-focus
io-contract:
  kind: deliverable
  produces:
    - kind: design-doc
      description: Prioritized roadmap slice with scope cuts, MVP selection, and explicit deferral rationale under founder/budget constraints
---

# Product Roadmap Focus

Use this skill when everything feels important. Its job is to force one clear
roadmap commitment, name what is being cut, and leave evidence that future agents
can replay instead of re-litigating the same choice.

This is not a generic backlog grooming skill. It is for ADHD founder/product
work where technical excitement, operator frustration, money pressure, and
multi-agent sprawl all compete for attention.

## Core Rule

The best next task is the smallest visible slice that most increases the odds of
a real user choosing the product again.

If a candidate does not improve operator trust, reduce a current blocker, create
customer proof, reduce existential risk, or unlock many follow-on tasks, it is
probably not "now." It may still be good. Put it in not-now with dignity.

## Decision Flow

```mermaid
flowchart TD
  A["Start: too many possible next moves"] --> B["Archaeology: what is already true?"]
  B --> C["Constraints: runway, deadline, trust, context, active PRs"]
  C --> D["Candidate inventory: 5-12 options max"]
  D --> E{"Any urgent trust or broken-core issue?"}
  E -->|Yes| F["Pick the smallest trust-restoring slice"]
  E -->|No| G{"Any slice can create customer/operator proof this week?"}
  G -->|Yes| H["Pick the proof slice"]
  G -->|No| I{"Any technical unlock gates many other slices?"}
  I -->|Yes| J["Pick the unlock slice"]
  I -->|No| K["Pick the highest learning-per-hour slice"]
  F --> L["Write focus receipt"]
  H --> L
  J --> L
  K --> L
  L --> M["Chunk into 30-90 minute steps or a small DAG"]
  M --> N["Record decision event and not-now list"]
```

## The Seven Lenses

Score lightly. Do not turn this into spreadsheet theater. Use 0, 1, 2, 3.

| Lens | Ask | High score means |
|---|---|---|
| Operator trust | What is currently making the product feel fake, scary, or unusable? | Fixing it makes the product credible today. |
| Customer proof | Does this produce screenshots, transcripts, demos, revenue, or user feedback? | A human can react to it this week. |
| Money/risk | Does this reduce burn, avoid waste, or improve the path to paid use? | It changes survival odds, not vanity. |
| Technical unlock | Does this unblock several other slices? | Many future tasks get cheaper. |
| Context economy | Does this reduce repeated archaeology or context loss? | Future agents stop relearning the same thing. |
| ADHD fit | Can this be finished in a few visible chunks without shame spirals? | Clear first step, visible progress, low switch tax. |
| Reversibility | Can we undo or revise if wrong? | Cheap to change after learning. |

Default formula:

```text
focus_score = trust + proof + money_risk + unlock + context_economy + adhd_fit + reversibility
switch_tax = active_contexts_touched + number_of_agents_needed + unclear_acceptance_gates
choose highest focus_score with tolerable switch_tax
```

If two choices tie, choose the one with the strongest operator-visible proof.

## Roadmap Focus Receipt

Every prioritization pass ends with this receipt. Use
`templates/roadmap-focus-receipt.md` for a copyable version.

```text
Decision:
Now:
Why now:
Evidence:
Evidence limitations / unverified boundaries:
Canonical/redacted source refs + hashes (raw local paths stay local/private):
Current runtime authority (selected daemon/local ledger):
Local read-back receipt + runtime scope:
Target shared authority (remote Oracle after proven cutover):
Attributable remote read-back receipt:
Projection watermark / staleness:
Accessible graph alternative (table/text):
Downstream impact before supersede/retire:
Not now:
Cut/suspend:
First visible proof:
Acceptance gate:
Kill/revisit trigger:
Owner:
Review date:
Retention class (hot/warm/cold) + restore target:
Privacy/legal holds:
Cost attribution { project, account, ingestUnits, embeddingUnits,
  storageByteHours, retrievalUnits, egressBytes }:
```

The not-now section is critical. ADHD systems fail when every good idea stays
half-alive. Cutting, parking, or deferring is an act of care.

## Agent Split Rule

Stay single-agent when:

- the slice has one owner and one acceptance gate;
- the change touches one subsystem;
- context transfer would cost more than the work;
- the user needs a coherent product judgment.

Split into a DAG or multiple agents when:

- archaeology, design, implementation, and review can progress independently;
- there are 3 or more genuinely parallel evidence-gathering paths;
- a human approval gate is needed before expensive or irreversible work;
- different agents can produce falsifiable artifacts, not just opinions;
- file/worktree boundaries are clean enough to avoid merge contention.

Never split just because more agents feels powerful. Split when the graph reduces
time-to-proof or raises review quality.

## Event Log Shape

Product decisions should be append-only. A changed mind is not a contradiction;
it is a new event with better evidence. Read `references/decision-event-schema.md`
when implementing daemon routes, pd-console panes, or roadmap projections.

Minimum events:

- `RoadmapCandidateObserved`
- `RoadmapSourceIngested`
- `RoadmapConstraintRecorded`
- `RoadmapFocusChosen`
- `RoadmapItemDeferred`
- `RoadmapFocusRevised`
- `RoadmapProofAttached`
- `RoadmapProjectionPublished`

Today, the selected daemon's local roadmap/item ledger is the runtime authority
and projection source for local coordination. The intended shared roadmap will
be rebuilt from remote decision events only after the remote writer is deployed
and an attributable remote read-back proves the cutover. A dashboard, graph,
snapshot, binder view, DAG, or hypertree remains a projection in either phase.

## Authority And Source Ingestion

A planning document is evidence, not a database. Markdown plans, binders,
roadmap snapshots, DAGs, and hypertrees can all contain excellent and unique
work, but none becomes current authority merely because it is detailed,
checked in, or named “canonical.” Classify every input explicitly:

- **source** — operator-authored or agent-authored material to ingest;
- **current runtime authority** — the selected daemon's local roadmap/item
  ledger, explicitly scoped to that runtime while the cutover is incomplete;
- **target shared authority** — the configured remote append-only work-event
  ledger, but only after deployed writes have attributable remote read-backs;
- **projection** — a dashboard, graph, snapshot, generated plan, or local cache;
- **receipt** — proof that a source was imported, linked, superseded, or rejected.

For Port Daddy, the target is one remote Oracle over append-only work events.
Each imported source keeps a canonical/redacted source URI, content hash,
authorship, observed time, parent/supersedes/dependency edges, and import
receipt. Raw local filesystem paths are private provenance: keep them local and
encrypted, or mark the event explicitly local/private; never publish an
operator path into the remote Oracle. The Oracle may project a roadmap, binder
view, DAG, or hypertree, but those views do not become rival authorities.

“Append-only” is a logical event contract, not a claim that the backing
database or object store is physically immutable. Recovery windows do not prove
tamper evidence. Require unique event ids, idempotent consumers that tolerate
retry/reordering, content hashes, and signed inclusion/Merkle receipts where
the store cannot enforce retention locks. Keep embedding spaces physically or
logically separated; bounded metadata filters are not a space-compatibility
check.

An `embeddingSpaceId` in a roadmap event is only a reference to an explicit
model-space record. That record, not the roadmap event, owns provider, model id,
immutable revision, dimensions, normalization, distance metric, dtype,
`qualityTier`, and any `degradedFallbackLabel`. Never infer quality from a model
name or turn roadmap events into a second model registry.

Until a deployed remote writer and an attributable remote read-back prove the
cutover, the selected daemon's local ledger remains the current runtime
authority and source for projections. Fail honestly: preserve source material,
scope local read-backs to that runtime, label generated output as a draft or
projection, and do not create another “authoritative” file. When the operator
prefers a newer plan, record that preference as attributable local evidence for
eventual import; do not silently erase unique older material or let an older
generated snapshot outrank it.

Before superseding, archiving, or retiring a source, traverse its downstream
decision, dependency, proof, projection, and user-facing-document edges. Append
the impact result and the chosen disposition; never infer “safe to delete” from
a successful import alone. Claims about current local authority cite the
selected daemon plus a local read-back and state their scope. Claims about
shared remote authority require the deployed writer's attributable remote
read-back and any missing-coverage or unverified-runtime boundaries.

Retention and searchability are separate policies. Define hot (interactive
index), warm (durable retrievable), and cold (encrypted archive) tiers with
explicit restore targets and legal/privacy holds. Attribute ingestion,
embedding, storage, retrieval, and egress cost to the source/project/account in
the receipt. Cost can change a tier; it cannot silently destroy provenance.

Graph projections must expose event-derived edges, staleness, filters, and
uncertainty without implying that layout equals causality. Ship an accessible
table or text outline beside the graph, keyboard navigation, readable contrast,
and a path from every rendered node to its source event and receipt.

## Anti-Patterns

### Shiny Criticality Inflation

Everything sounds existential because the idea is exciting. Detection: the task
has no user-facing proof, no current blocker, and no acceptance gate. Fix: move it
to not-now and choose the proof slice.

### Architecture Before Trust

The team designs a perfect substrate while the operator still cannot see a live
agent, transcript, file diff, or recovery path. Fix: prioritize the smallest
operator-trust proof before the grand architecture layer.

### Eight Open Loops Day

The roadmap has many active threads and no visible finish. Detection: more than
two active contexts require working memory at once. Fix: choose one now, one next,
and explicitly suspend the rest.

### Hidden Runway

The work ignores money, time, or energy constraints because they feel stressful.
Fix: name the constraint in the receipt. This is not financial advice; it is
product survival awareness. Escalate real financial planning to a qualified
professional.

### Decision Amnesia

Agents revisit the same priority argument every week. Fix: write a focus receipt
and append a decision event. Future agents may revise it only by citing new
evidence.

## Worked Example: Port Daddy Control Panel

Situation:
  The website can talk about harnesses, but the operator still cannot reliably
  see live transcripts, active sessions, model identity, files touched, and
  interrupt controls inside pd-console.

Candidates:

- more marketing art;
- Cloudflare marketplace;
- transcripted compliant Agent Node;
- mobile app;
- public skill sharing.

Decision:
  Now: transcripted compliant Agent Node in pd-console.

Why:
  It restores operator trust, creates demo proof, unlocks compliance testing,
  reduces repeated archaeology, and makes every later page less speculative.

Not now:
  Marketplace, broader federation, and new art unless needed to explain the
  actual working control panel.

Acceptance gate:
  A local Codex or Claude Code body and a Cloudflare body appear in pd-console
  with transcript, stream state, model/tier, files touched, controls, and a saved
  receipt.

## Quality Gates

- [ ] The selected now item has one visible proof artifact.
- [ ] The not-now list names at least three tempting things being cut or parked.
- [ ] Acceptance gate is binary enough that another agent can verify it.
- [ ] First step is under 90 minutes.
- [ ] Context switch count is named.
- [ ] A revisit trigger exists.
- [ ] If work is split, every agent has a distinct artifact and file/worktree boundary.
- [ ] A focus receipt or decision event is left in durable project memory.
- [ ] Every planning input is labeled source / current runtime authority /
      target shared authority / projection, and a claimed remote write has an
      attributable remote read-back receipt.
- [ ] Retirement has a downstream-impact receipt; unique evidence and holds are preserved.
- [ ] Hot/warm/cold retention, restore target, and per-source cost attribution are explicit.
- [ ] Every graph projection has an accessible non-visual view and links nodes
      and edges back to event evidence, staleness, and limitations.

## Activation Tests

Should activate:

- "What is the most important thing to work on next?"
- "Prioritize this roadmap and tell me what to cut."
- "Which MVP slice should we ship first?"
- "Should this be one agent or a DAG?"
- "Everything feels urgent; pick the next Port Daddy control-panel slice."

Should not activate:

- "Implement the already-selected `/agents` route."
- "Run the test suite."
- "Write CSS for this specific button."
- "Explain CQRS in general."
- "Give me personal investment advice."

## References

- `references/decision-event-schema.md` - Load when implementing roadmap event
  storage, projections, APIs, or pd-console priority panes.
- `templates/roadmap-focus-receipt.md` - Use when leaving a note, PR comment, or
  roadmap decision artifact.
