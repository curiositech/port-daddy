# pd helmsman — the autonomous roadmap execution agent

**Status:** Proposal · planning slice only (no implementation in this PR)
**Branch:** `claude/agent-open-issues-roadmap-7ktzh0`
**ADRs:** 0121 (charter) · 0122 (merge authority) · 0123 (issue lifecycle) · 0124 (control ingress + consent transport)
**Author:** helmsman planning session (2026-08-22), operator-directed

> **The pitch in one sentence.** Port Daddy has every organ of autonomous
> execution — a dispatch worker that drains its queue overnight, an atomic
> roadmap claim, a governed WorkIntent funnel, a bounded auto-merge gate — and
> no chartered consumer connecting them; Helmsman is that consumer, climbing a
> trust ladder from propose-only to bounded auto-merge, while the operator
> follows, steers, and approves it from inside Port Daddy's own surfaces.

## Why now (the four findings this program answers)

1. **Nobody works the backlog.** No durable agent is chartered to consume open
   issues or roadmap items. The gap is deferred in three places:
   `docs/proposals/pd-nightshift.md` ("self-driven backlog scanning … a future
   loop"), ADR-0116/0117 (deferred PR-authoring intake), and ADR-0119 (durable
   agent triggers frozen at `declared`).
2. **Issues are a write-only exhaust.** 7,889 open issues on 2026-08-22, 99.4%
   `fleet-idea` machine exhaust growing ~460/day. Twelve code paths file
   issues; effectively zero read them; `closeIssue`
   (`lib/fleet/github-output.ts`) has no call sites.
3. **The roadmap is an inbox, not a plan.** 279 items (103 simultaneously
   "now", 13 done) with a schema too small for evidence or provenance, while
   >15 MB of real planning prose (PLAN.md, nine proposals, the 988 KB
   technical binder, shipwright, north-star, 90 static HTMLs) has near-zero
   linkage into the table. The binder — the operator's declared real roadmap —
   is ~35% built, ~15% proven by its own gates, and frozen since 2026-07-10.
4. **Merge authority is designed but unenforced.** ADR-0109's Steward is prose;
   the branch ruleset requires zero approvals; AGENTS.md tells every agent to
   drive its own PR to merge — the exact disease ADR-0109 diagnosed.

## Part I — The engine

### 1. Helmsman, the agent

The Navigator and Cartographer plot the course; the **Helmsman** steers the
ship along it. (Name checked against the actor roster and fleet ships — no
collision; the operator-tui-v3 mockup's fictional helmsman driving a PR to a
merge gate under a HiTL approval is precedent.)

**Reads:** `roadmap_items` only. GitHub issues never become work directly —
they reach the roadmap only through the mining rail (Part I §2, binder ch23's
rule). Binder prose enters as milestone slugs (§5), never as a direct read.

**Selects:**

```
eligible(item) :=
  status == 'now'
  AND all dependencies done
  AND item.execution_json present        # checkable acceptanceGate + budgetUsd + class
  AND slug not on the never-list
rank = focus_score (seven lenses, scored at triage)
     × binder_weight (1.5 when source_refs contains binder:*)
     − switch_tax
```

On day one almost nothing is eligible. That is intentional: shaping an item
properly becomes the only way work reaches the autonomous lane, which is the
incentive that fixes the inbox-roadmap. The H0 sortie plan lists the top-3
*near-eligible* items with the one missing field named, so operator attention
converts directly into shaped items.

**Claims:** the existing atomic `POST /cartographer/roadmap-pop` (ADR-0033/34)
with eligibility pushed into the pop predicate — Helmsman and a human
`pd roadmap pop` can never double-claim.

**Executes:** `pd dispatch propose` into the existing server-side dispatch
worker (`lib/dispatch/worker.ts`), `merge_policy: 'review'`. Helmsman ships
**before** the WorkPlanner: the dispatch queue is already a fail-closed
projection of WorkIntents (`captureDispatch`, deterministic
`dispatchIdForWorkIntent`), so riding the compat path adds zero new launch
verbs and zero independent state. The migration trigger is recorded in
ADR-0121: when the WorkPlanner lands, Helmsman switches to direct
`WorkIntentService.create` with `source.kind: 'schedule'` — the union member
that exists today with zero producers. To keep the compat path from
ossifying, **H2 is contractually gated on the WorkPlanner landing** — autonomy
scale-up pays for the governance layer.

**Trust ladder** (full contract in ADR-0121):

| Rung | Behavior | Merge | Enter | Demote |
|---|---|---|---|---|
| **H0** propose-only | Daily sortie plan: ≤3 eligible items with score, budget, acceptance gate, as a consent card; executes nothing without per-item approve/modify/reject | n/a | charter lands | — |
| **H1** dispatch | Auto-proposes eligible items into dispatch; PRs open under `merge_policy: 'review'` | operator / authorized paths | first time: operator command after 10 clean H0 approvals; re-entry after demotion: 10 clean receipts auto-promote | reverted PR, budget breach, red adversarial verdict → H0 |
| **H2** bounded auto-merge | `merge_policy: 'auto'` for bounded classes (docs-only, tests-only, roadmap-sync) through the existing `lib/dispatch/auto-merge.ts` gate + never-list | auto-merge gate | first time: operator command; requires 10 clean H1 receipts AND the WorkPlanner landed AND ADR-0122 merged AND the steer verb live | any auto-merged revert → class removed, back to H1 |

Promotion policy (operator decision 2026-08-22): the **first** promotion to
each rung is an explicit operator command; thereafter N-clean-receipts
auto-promotes on re-entry. Demotion is always automatic and immediate. Every
promotion and demotion writes an inbox note and a focus receipt.

**Budgets (H1 defaults):** $2/dispatch, $10/day, max 2 in flight, max 2 open
Helmsman PRs, 1 pop per tick, hourly schedule. Any cap breach → automatic
self-demotion one rung + inbox note.

**Kill switches:** `pd fleet down helmsman`; a `helmsman.enabled` daemon flag
checked at tick start; the dispatch never-list; the human-only ruleset admin
bypass. If H0 approvals go stale >7 days, Helmsman self-pauses rather than
nagging.

**Helmsman never merges directly at any rung.** It sets `merge_policy`;
landing belongs to the authorized paths of ADR-0122.

### 2. Issues, interpreted separately from the roadmap (ADR-0123)

Three moves, in order:

1. **Stop the bleeding** (−460/day): ideation ships (spark/spider/lookout/
   snipe) write terminally to the D1 ideas store — which already dedups —
   and stop filing GitHub issues. Issues become reserved for actionable
   machine findings (`fleet:broken-ship`, `coverage-gap`) and humans.
   (Operator decision: redirect-and-keep-ideating, not pause.)
2. **Mass-close the corpus** — operator-fired, never autonomous. Archive-export
   every `fleet-idea` issue first (the mining input), then bulk-close with a
   comment linking the archive and the mining slug. First real `closeIssue`
   call site. (Operator decision: bulk-close after archive.)
3. **Mine once, at batch scale**: revive the existing `idea-mining-pipeline`
   slug (updated in place, not duplicated) rescoped from 400 → ~7.9k inputs,
   one offline batch: normalize → embedding dedup (cos ≥ 0.85 duplicate,
   0.65–0.85 `EXTENDS:<slug>` note) → viability filter → **hard cap ≤50** new
   `backlog` rows carrying `source_refs: issue:#N`.

A live-tracker taxonomy (`kind:defect|task|idea`, `area:*`, `pd:selectable`)
makes surviving issues selectable for *triage into the roadmap* — issues stay
permanently outside Helmsman's read set. The closer loop gets three call
sites, in landing order: the mass-close batch; mining (close each consumed
issue with `mined:<slug>` or `dup-of:#N`); dispatch settle closing `Closes #N`
references on merged PRs.

### 3. Roadmap enrichment

- **Schema** (rides the existing `roadmap-schema-wiring` slug): four additive
  nullable columns on `roadmap_items` — `body_md`, `evidence_json`,
  `source_refs_json` (typed refs: `doc:<path>#<anchor>`, `adr:NNNN`,
  `issue:#N`, `binder:chNN`, `binder:mN`), `execution_json` (acceptanceGate,
  budgetUsd, class — Helmsman's eligibility contract). The same slice fixes
  the snapshot full-overwrite (contradicting `docs/roadmap/AUTHORITY.md`) and
  the harbor-filter count divergence, and stops the projection dropping
  `dependencies`.
- **Wire the orphaned ADR-matrix sync** — the cheapest win in the program.
  `lib/adr-matrix.ts` is a complete, tested, pure transform with zero callers.
  Add `POST /adr/sync` + `pd adr sync`, and run it as a step in the existing
  Cartographer fleet lane so the lane finally writes **rows**, not markdown.
  Immediate payoff: ADR-0121–0124's own Implementation Matrices become live
  roadmap rows.
- **"Now" triage**: 103 → ≤10. Cartographer pre-scores all current "now"
  items with the seven lenses; the operator confirms a top-10; everything else
  demotes with a one-line note. Standing guard: a Cartographer finding when
  now-count exceeds 15.
- **Harvest priority** for the lost corpus: binder ch18 work orders + CR
  register + IT-001..14 → the nine `docs/proposals/` → UNIFIED-ROADMAP +
  Next Cuts → IDEAS-TROVE. Explicitly **not** harvested (routed to AoR
  ambition-archaeology instead): the 90 static HTMLs, `docs/shipwright/`,
  `whitePapers.ts`, PLAN.md deep history — where "rejected with a rationale"
  is a cheap and valid resting state and "we forgot" is not.
- **Binder linkage**: rows `binder-m0`..`binder-m10` with real dependencies;
  every binder-derived item carries `source_refs: binder:chNN`; the 23
  existing binder-referencing slugs whose statuses contradict shipped code get
  reconciled in the same slice. "How are we doing on the binder" becomes
  `pd roadmap list --source binder:*` — a query, not an archaeology dig.

### 4. Merge authority (ADR-0122)

Amend ADR-0109 to enforceable reality; add a detective control; do **not**
build the macaroon now (that would repeat the built-tested-unwired pattern).
Five authorized landing paths, exhaustively: operator; Steward per its
charter; `release-train.yml` version-bump self-merge; `lib/dispatch/
auto-merge.ts` under its 4-condition gate + never-list; harbormaster after
`pd review --accept`. Agents author PRs and get them green; **landing belongs
to the authorized paths.** A scheduled `merge-audit` workflow checks
`merged_by` + merge path against the allowlist and files a
`fleet:broken-ship` finding on violations. Helmsman's H2 classes are exactly
the auto-merge gate's — one shared definition of "bounded" for every
autonomous path.

### 5. Binder revival

The AoR process died of ceremony plus a DB that ate its ledger; fix both. The
ledger moves to committed append-only files
(`docs/architecture/agent-harbor-technical-binder/aor-log/YYYY-MM-DD*.md` —
this PR writes the first entry); the run shrinks to a 20-minute checklist with
one rotating coverage axis; monthly cadence via a fleet lane, executed by
Cartographer wearing `architecture-binder-of-record`; an empty run still
writes its entry (absence is itself a finding).

Binder weighting of Helmsman's selection is **soft 1.5×** (operator decision):
binder-derived items rank higher, no hard filter — a hard filter would starve
Helmsman at H0/H1 exactly when it needs clean receipts to climb. The weight
may be raised to a filter by operator command once binder milestones are
shaped.

### 6. Skills at session start (operator directive)

The mechanism mostly exists — the work is "turn it on and bound it":
`skill_graft: true` becomes the default for every fleet ship;
`renderSkillGraftContext` is called at dispatch body materialization keyed on
the goal text; the Pilot SessionStart hook gains a bounded skill index (~4 KB
+ top-3 SKILL.md bodies via `maxBodyChars`). The per-prompt hot path stays
zero-byte per the hook-budget rules; conformance rides the existing squid
release smoke.

## Part II — The Operator Experience

### OX-1 · Following progress

Surface ownership per the triad law (intake→Scout, ambient→FleetBar,
deep→pd-console; one surface per capability; no surface renders a control the
daemon cannot enforce):

- **FleetBar** owns exactly two Helmsman things: the unified needs-you count
  (OX-4) and one pending consent card at a time. Anything needing more than
  one screen of evidence deep-links into pd-console.
- **pd-console** owns the live view. The multiplex spine is what already
  exists: `GET /agent-roster` (which already fuses local agents, cloud
  telemetry, sessions, claims, and per-worktree squid conformance) plus one
  `lane_pane` per in-flight body over `GET /agents/:id/stream`. The sortie
  overview rides the existing `sortie_pane` row grammar; receipts land in
  `inbox_pane` and `pd morning`.
- **Zero new push transports.** Cool objects (sortie plan, receipts, roster,
  control-command rows) poll ≤30 s per the hitl-interruptions UI contract; the
  only pushes are the two that exist — per-lane SSE and the approvals
  WebSocket. The binder ch19 one-hot-bus-per-surface consolidation is the
  named P3 slug `console-hot-bus-consolidation`, not an MVP dependency.
- Every in-flight lane shows the anti-Infinite-Spinner set: heartbeat, current
  step, spend meter, cancel, inspectable transcript.

### OX-2 · Jumping into agents (ADR-0124, part 1)

Ship the two verbs that can be honest: **interrupt** (C4) and **steer** (C3).
Pause/checkpoint/fork stay unrendered until a backend supports them; kill
remains dispatch cancel + `pd fleet down`.

Leased lifecycle replaces fire-and-forget: the ingress writes the
`control_commands` row `queued`, publishes to `agent:<id>` (`delivered` on
publish), and **acknowledgment requires witnessed evidence** — a squid
pre-tool hook receipt, a tube reply, or session rent naming the command id;
TTL expiry → `expired`. Hot makes it fast; the durable row makes it
undeniable. `POST /agents/:id/interrupt` becomes a shim over the ingress.

Per-backend honesty:

| Backend | interrupt | steer |
|---|---|---|
| `cli:claude-code` | enforced — pre-tool `exit 2` denies the next call with `denialReason: operator interrupt`, then SIGINT escalation; acked by hook receipt | **steer-as-denial**: the denial body carries the operator's note (agent-visible), plus the tube-poll convention written into every Helmsman spawn prompt |
| `cli:codex` | process termination (acked on exit); upgrades to enforced pre-tool denial once `codex-squid-verification` lands | `unsupported` until the verified adapter — honest fallback is successor-with-handoff: cancel + re-propose with the note injected (= the `pd review --retry` contract); button renders disabled with the stated reason |
| `cli:agy` | process termination (acked on exit); upgrades with `agy-squid-adapter` | `unsupported` until the verified adapter — same successor-with-handoff fallback |
| `cloudflare` (PD-owned harness) | harness-loop stop between provider calls — PD owns the loop, so interrupt is a loop-boundary check, acked by the harness | steer note injected at the next loop boundary — PD owns prompt assembly |
| observed / interactive | `unsupported` (control-gate already refuses C2+ on observed bodies) | `unsupported` |

Sequencing: H1 depends on the interrupt verb landing; H2 additionally on
steer — autonomous merging without mid-flight steering is operator-hostile.

### OX-3 · Approving new agents (ADR-0124, part 2)

One consent transport: `lib/fleet/approval-stream.ts` (its own header invites
the convergence). `PendingApproval` gains `kind: 'trust-gate-spawn' |
'helmsman-sortie' | 'chat-intent'` and the snapshot a `protocolVersion`.

Card contract (per HITL_STANDARD): **four-state**
approve / reject / modify-with-reason / skip. Sortie modify is a cheap
re-plan with the note injected (ships in P1); dispatch-review modify is the
implemented `pd review --retry` (P2 slug `review-retry-contract`). **Cost on
every card** (`budgetUsd` + estimate — SpawnApprovalSection gains the cost
row it lacks). The inline diff belongs to the *review* card in pd-console
(triad law); FleetBar deep-links. **Force-zoom** — no approve from the
collapsed card — applies to irreversible classes (release/deploy, mass-close,
data-deletion) **and to the first run of any new sortie class** (operator
decision 2026-08-22); later runs of a known class get the glanceable card.

**Chat consent gate** (P1): the console ChatSend path currently captures and
starts a WorkIntent from a bare typed message with no consent and no cost
shown. The daemon will refuse `start` for chat-synthesized intents without a
consent token minted by an explicit one-keystroke confirm card (goal, file
scope, backend, cost estimate). Enforced in the daemon, not the UI. Any
future auto-confirm-under-$X convenience must be a daemon-enforced ceiling,
never a UI preference.

### OX-4 · What escalates, and how

Disposition (adopted from ADR-0085): auto-proceed with anything mundane at
the granted rung; **escalate iff** duplicate (overlaps an in-flight
dispatch/claim) · clash (file-claim or roadmap-dependency conflict) ·
high-impact (irreversible class, cost above cap, never-list-adjacent) ·
low-confidence (missing `execution_json` field, unverifiable acceptance
gate).

Delivery rides the **shipped** relay interruptions ladder:

| Helmsman event | urgency |
|---|---|
| in-flight dispatch blocked awaiting a human; budget-breach stop | **critical** (blocks dependent new work; mayday-red) |
| staleness self-pause imminent; automatic demotion fired | high |
| sortie plan awaiting decision; `review_pending` | normal |
| receipts digest | low |

Charter rule: Helmsman never files a critical for a *proposal* — mayday-red is
reserved for in-flight blockage (ADR-0046's HiTL-bar rule).

**Queue unification** (P1 slug `needs-you-unification`): `operator/state`
`needsYou` becomes the front door; pending fleet approvals, proposals, and
open interruptions bridge in as read-side counts with `ref` deep-links,
deduped by ref key. The FleetBar badge renders `needsYou.count` and nothing
else — one number, one place. After Stage 2 (OX-8), interruption deep-links
open the pd-console lane directly and FleetBar shrinks to the pure badge
(operator decision 2026-08-22).

### OX-5 · Remote harbors and multiple operators

Helmsman v1 claims **single-operator, single-machine, local daemon** —
honestly. The relay client half (`RelayConnectionManager`) is written and
unwired; the daemon reports disconnected; doctrine D9 forbids pretending
otherwise. The deferred chain is named, not scheduled:
`relay-client-wiring` → `helmsman-receipts-to-relay` (X2 harbor co-members
see Helmsman receipts) → `multi-operator-helm-command` (the Helm and its
succession decide who commands; doctrine D6 one-decider — ADR-0121 names
exactly one operator identity holding promotion/demotion/never-list
authority; co-members see, never command; the Helm governs relay artifacts,
never remote machines).

### OX-6 · Runtime — backend selector, equal citizens, seamless failover

**Operator requirement (2026-08-22): no backend pin.** Helmsman must offer a
model/backend selector and work equally well on claude-code, codex, agy, and
a set of Cloudflare AI models — and a failure on one must resume seamlessly
on another.

- **Selector.** Helmsman's ADR-0119 durable profile carries ordered
  `backendPreferences` (default `['cli:claude-code', 'cli:codex',
  'cli:agy', 'cloudflare']`), operator-editable. The dispatch path reads
  them — `backend-preferences-wiring` moves onto the H1 critical path (P1).
  The sortie consent card shows the selected backend and offers per-item
  override via `execution_json.backend`, which wins over profile order.
  Cloudflare AI models run as the PD-owned-harness dispatch class (Port
  Daddy owns tools, transcript, and state per the backend catalog; model
  choice rides the declarative model registry) — slug
  `cloudflare-harness-backend`.
- **Equal citizens.** "Equally well" is the target, reached by verifying
  instrumentation rather than pretending it: `codex-squid-verification`
  moves to P2 (the adapter exists, `verified=false` — capture one live
  block, flip the flag) and `agy-squid-adapter` (new) authors + verifies the
  agy adapter. Until a backend's adapter is verified it runs at a
  **disclosed capability tier**: the lane shows "harness: none — controls
  limited" and ADR-0124's per-backend matrix decides which controls render
  enabled. Injection-or-refuse applies only when the selected backend claims
  a verified adapter and injection fails.
- **Failover = resume, never restart** (slug `helmsman-backend-failover`,
  P2). On failure or stall on backend A: one retry on A for a transient
  cause, then a **successor dispatch on the next backend in preference
  order** under the ADR-0118 continuation contract — same-family: witnessed
  native session resume; cross-family: the sanitized handoff successor
  capsule (never raw transcript replay). The successor binds the same
  roadmap claim and the *remaining* budget; every attempt writes a durable
  continuation receipt; the lane renders the succession chain. Backend
  failure never demotes the trust ladder (it is not Helmsman misbehavior),
  but three failovers in a day pages `high`.

### OX-7 · The squid harness

Roster conformance already flows (`GET /agent-roster` reads it per worktree).
New in P2: `GET /squid/timeline` — bounded, metadata-only,
privacy-projected — feeding the lane's harness-heartbeat chip, the
daemon-side witness that a body's hooks are actually firing. A lane whose
conformance is stale renders its controls disabled with the reason: that is
what keeps OX-2's buttons honest. Helmsman-class dispatches flip squid
injection from warn-and-continue to **refuse-to-spawn when the selected
backend has a verified adapter and injection fails** — a `pd squid status`
precheck in sortie eligibility predicts refusal at plan time. A backend
without a verified adapter is not refused (portability is the requirement,
OX-6): it runs at its disclosed capability tier with "harness: none —
controls limited" on the lane, and closing that tier is scheduled work
(`codex-squid-verification`, `agy-squid-adapter`).

### OX-8 · The endgame: solely inside a Port Daddy app

Three falsifiable stages, each demoed under the Show-Me Runbook (registered
berth, seeded live state, the GPUI app — never repl artifacts):

1. **"Consent without leaving the app"** (exit of P1). Gate: on a seeded
   dev-triple, the operator sees one needs-you count in FleetBar, opens the
   pending sortie card, modifies one item with a note and approves the rest,
   and sees the dispatch-enqueue receipt in pd-console — no iTerm, no `pd`
   CLI.
2. **"Follow and steer without leaving the app"** (exit of P2). Gate: with two
   live Helmsman bodies, the operator opens a mux split of two lanes, watches
   heartbeat + spend + current step on both, interrupts a claude-code body
   and sees its ControlCommand row go queued → delivered → acknowledged in
   the pane; a codex body shows steer honestly disabled ("unsupported —
   successor-with-handoff available"). No terminal.
3. **"A roadmap item goes now → done inside the app"** (exit of P3). Gate —
   **declared to be the same test as ADR-0046 phase 6's**: sortie approve →
   lanes → review with inline diff and four-state (including a real
   `--retry`) → merge via an authorized landing path → receipt in the inbox,
   each step attest-gated and HiTL-surfaced, against the live daemon, not
   mocks. The two autonomy programs converge instead of running parallel
   loops.

## Sequencing

MVP = P0 + P1. Part II grew the MVP by three consent/safety slugs, and the
backend-portability requirement (OX-6) added `backend-preferences-wiring` as
the fourth — Helmsman must be selector-driven before it dispatches anything.

| Phase | Slug | New? | Depends on |
|---|---|---|---|
| P0 | `helmsman-charter` | new | — |
| P0 | `fleet-idea-intake-redirect` | new | — |
| P0 | `adr-matrix-sync-route` | new | — |
| P0 | `roadmap-now-triage` | new | — |
| P0 | `merge-authority-reconciliation` | new | — |
| P1 | `helmsman-h0-sortie-plan` | new | `helmsman-charter`, `roadmap-now-triage`, `roadmap-schema-wiring`, `approval-stream-four-state` |
| P1 | `chat-consent-gate` | new | — |
| P1 | `approval-stream-four-state` | new | — |
| P1 | `needs-you-unification` | new | — |
| P1 | `issue-mass-close-fleet-idea` | new | `fleet-idea-intake-redirect` |
| P1 | `roadmap-schema-wiring` | existing, rescoped | — |
| P1 | `merge-audit-detective-check` | new | `merge-authority-reconciliation` |
| P1 | `binder-aor-restart` | new | — |
| P1 | `backend-preferences-wiring` | new | `helmsman-charter` |
| P2 | `control-command-ingress` | new | `approval-stream-four-state` |
| P2 | `helmsman-h1-dispatch` | new | `helmsman-h0-sortie-plan`, `control-command-ingress`, `backend-preferences-wiring` |
| P2 | `helmsman-backend-failover` | new | `backend-preferences-wiring` |
| P2 | `codex-squid-verification` | new | — |
| P2 | `squid-timeline-route` | new | — |
| P2 | `review-retry-contract` | new | — |
| P2 | `idea-mining-pipeline` | existing, rescoped | `issue-mass-close-fleet-idea`, `roadmap-schema-wiring` |
| P2 | `binder-milestone-slugs` | new | `roadmap-schema-wiring`, `binder-aor-restart` |
| P2 | `skill-graft-default-on` | new | — |
| P2 | `pilot-skill-index-sessionstart` | new | `skill-graft-default-on` |
| P3 | `workintent-dispatch-intake` | existing (gates H2) | — |
| P3 | `helmsman-h2-bounded-automerge` | new | `helmsman-h1-dispatch`, `workintent-dispatch-intake`, `review-retry-contract`, `merge-authority-reconciliation` |
| P3 | `console-hot-bus-consolidation` | new | — |
| P3 | `cockpit-spawn-input` | new | `chat-consent-gate` |
| P3 | `observed-session-lanes` | new | — |
| P3 | `agy-squid-adapter` | new | `codex-squid-verification` |
| P3 | `cloudflare-harness-backend` | new | `backend-preferences-wiring` |
| P3 | `idea-intake-phases-1b-1d` | existing scope (ADR-0085) | `roadmap-schema-wiring` |
| P3 | `roadmap-doc-harvest` | new | `roadmap-schema-wiring` |
| Deferred (named, unscheduled) | `relay-client-wiring` → `helmsman-receipts-to-relay` → `multi-operator-helm-command` | new names | in that order |

## Skill-constraint mapping

| Repo skill | Constraint it imposed | Where it shaped this proposal |
|---|---|---|
| `legible-roadmap-with-sidequests` | one canonical roadmap; link-or-opt-out costs one line; spawned work captured in the same sitting | Helmsman reads only `roadmap_items`; this PR carries its own `Roadmap-Spawns:` trailer |
| `work-intake-node-shaping` | legacy verbs are compat metadata into one WorkIntent funnel, never a second launch path | ship on dispatch-compat *because* it already projects into WorkIntentService; migration trigger recorded |
| `product-roadmap-focus` | smallest visible slice; the not-now list is load-bearing | the 103→≤10 triage; the explicit not-harvested list; MVP line at P0+P1 |
| `architecture-binder-of-record` | capability = owner + gate + evidenceLink; append-only AoR ledger every run | committed-file aor-log; the first entry ships in this PR |
| `human-gate-designer` | gate before irreversible; four-state with Modify; cost/confidence on the card | the trust ladder; ADR-0124's card contract; force-zoom set |
| `agent-issue-tracker-workflow` | search before creating; close with evidence | existing slugs rescoped in place; every issue close carries `mined:`/`dup-of:`/PR evidence |
| `operator-surface-authority-designer` | one surface per capability; no unenforceable controls | OX-1 ownership split; controls disabled-with-reason when conformance is stale |
| `agent-control-command-contract` | distinct verbs, full lifecycle, authoritative authz | ADR-0124 verb set, leased lifecycle, witness-based acks |

## Risks (called out, not hand-waved)

- **Compat-path ossification** — mitigated structurally: H2 is gated on the
  WorkPlanner; autonomy pays for governance.
- **Detective-not-preventive merge control** — accepted and named; the
  macaroon stays honest backlog, not a pretended control.
- **Triage/approval load on the operator** — Cartographer pre-scores; cards
  are one-keystroke; Helmsman self-pauses on stale approvals instead of
  nagging.
- **Mass-close destroys signal** — archive export is a hard precondition;
  mining runs within 30 days of the close or the close is revisited.
- **Snapshot integrity underlies the link gate** — fixed inside
  `roadmap-schema-wiring`, sequenced before H1.
- **Steer-as-denial rides vendor hook semantics** — a squid smoke probe
  asserts denial-message visibility; steer reports `failed` when the probe is
  stale, never a silent no-op.
- **Approvals protocol widening** — `protocolVersion` in the snapshot;
  unversioned clients get legacy two-state cards.
- **needs-you double-count kills glance trust** — dedup by ref key; a wrong
  badge number on the one-number surface is worse than no badge.
- **Injection-or-refuse can halt autonomy on stale hooks** — by design; it
  pages `high`, never fails silently.
- **Eligibility too strict at launch** — by design; the sortie plan surfaces
  near-eligible items so approval energy converts into shaped items.
- **Cross-family failover loses in-flight nuance** — the successor capsule is
  a sanitized brief, not a transcript, by contract (ADR-0118). Mitigation:
  the capsule carries the acceptance gate + work-so-far summary + the
  operator's steer notes; a failover that would lose an uncommitted diff
  parks the worktree as salvage first.
- **Backend capability tiers can mislead** — a lane must never render a
  control the selected backend cannot honor; the tier chip
  ("harness: none — controls limited") and ADR-0124's matrix are the
  disclosure, enforced daemon-side.
