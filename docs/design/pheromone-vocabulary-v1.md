# Pheromone Vocabulary v1 — Kind Catalog & Decay Model

**Status:** v1, accepted
**Author:** pheromone-vocab-design sortie (2026-05-19)
**Reviewers:** operator + downstream implementers of `pheromone-decay-per-kind` and `pheromone-spray-wiring`
**Scope:** Design doc only. Implementation is downstream.

**Anchor docs:**
- `docs/ROADMAP.md` § 8 — Substrate Activation. Source for the three typing rules and the strawman primacy axis.
- `.scratch/pheromone-visualization-research.md` — five visualization modes (A heat tree, B AST overlay, C time-axis sparkline, D operator tile, E enriched `pd sniff`); multi-kind composition; bivariate-choropleth lesson.
- `lib/pheromone.ts:18` — `createPheromoneManager`, single global `decayRate` today (lines 18, 65, 113, 139); this doc unblocks per-kind half-life.
- `lib/tuples.ts:40` — `createTupleSpace`; facts go here, not into pheromones (typing rule below).
- `lib/feedback.ts:142` — `createFeedback`; human/agent annotations land here, not in pheromones.
- `routes/pheromone.ts:46` — `POST /pheromone/spray`; current spray surface. Already accepts `(table, id, key, strength)`; `key` is the kind name we lock here.
- `cli/commands/pheromone.ts:154-178` — current ASCII heat bar; conflict glyph rendering.

---

## 1. Typing rule (one paragraph; do not break)

Pheromones encode **graded attention**, never facts. A pheromone is a scalar in `[0, 1]` on a target (file / region / symbol / project / harbor / actor) that **decays toward zero on its own** and that **multiple writers blend by overwrite or max**. If the thing you want to store has a true/false answer ("this commit reverted that one"), a stable identity ("agent A succeeded on task T"), or auditable history ("here's the human's feedback"), it belongs in a tuple (`lib/tuples.ts:40`), a feedback row (`lib/feedback.ts:142`), or an episodic-memory entry — **not** a pheromone. Pheromones answer "is this hot right now?" and the half-life is what gives that question a meaningful answer; storing a fact as a pheromone destroys it on the next evaporation tick. See `docs/ROADMAP.md` § 8 ("pheromones for graded attention; never for facts").

---

## 2. The Kind Catalog (18 rows, locked for v1)

Columns: **name** · **meaning** · **when-to-spray** · **who-cares** (reader) · **target-type** · **initial-strength** · **half-life** · **decay_during_idle** · **clear_events** · **composition role**.

Half-life is the time (in seconds) for the value to fall to half its current strength under continuous decay. `decay_during_idle = false` means decay pauses when the daemon detects no fleet activity — this respects vibe-coding's bursty pattern (you walk away for 4 hours, the human-block is still a human-block). `clear_events` are tuple kinds whose appearance hard-resets the pheromone to zero regardless of decay state. Composition roles map to the visualization research (`.scratch/pheromone-visualization-research.md` § 3) — `drives_color` = participates in the primacy-axis blend; `always_visible` = guaranteed glyph slot regardless of dominance; `glyph_only` = badge only, never drives color; `suppressed_when_others_present` = hide if any always-visible kind is also active on the same target.

### Topological — "where to go / not go"

| name | meaning | when to spray | who cares | target | init | half-life | idle decay | clear events | role |
|---|---|---|---|---|---|---|---|---|---|
| **`hot:editing`** | This target is being edited right now. | Spawner / IPC hook detects an active file write or claim refresh. | Other fleet agents (avoid stomping); operator (heat tree). | file, region, symbol | 0.9 | **300 s** | **true** | `file:claim:released`, `session:done` | drives_color |
| **`cold:abandoned`** | A session died holding this without a clean `done`. | Salvage scan on session TTL or daemon restart. | Salvage agents; operator (resurrect candidate). | file, session | 0.7 | **86400 s** (24h) | **false** | `salvage:claimed`, `salvage:dismissed` | glyph_only |
| **`flow:hot-path`** | This sits on a critical path agents keep touching. | Periodic rollup: ≥ 3 distinct agents touched the target within 1 h. | Approvers (don't churn here); planners (sequence work). | file, symbol | 0.6 | **3600 s** (1h) | true | `file:cooled` (no touches in 30 min, manual) | glyph_only |
| **`recent:touched`** | Softer than `hot:editing` — claim touched the file at all in current window. | On every `pd session files add` or claim refresh. | Spawner ("recently touched, prefer adjacency"). | file, region | 0.4 | **900 s** (15m) | true | `file:claim:released` | glyph_only |

### Economic / attention — "where the money / time is bleeding"

| name | meaning | when to spray | who cares | target | init | half-life | idle decay | clear events | role |
|---|---|---|---|---|---|---|---|---|---|
| **`attention:human-blocked`** | Agent posted to `inbox:human` and is waiting. | `inbox.post(channel=human)` or `human-gate` checkpoint. | Operator (highest priority); FleetBar; web dashboard tile. | session, project, actor | 1.0 | **event** | **false** | `inbox:human:resolved`, `session:cancelled` | **always_visible** |
| **`cost:burning`** | Wallet draw rate exceeds threshold (currently $0.50/10min). | Cost ledger rollup tick; bond accrual hook in `lib/bonds.ts`. | Operator; budget enforcer (auto-pause). | session, project, actor | 0.8 | **600 s** (10m) | true | `session:done`, `budget:throttled` | **always_visible** |
| **`budget:nearing-cap`** | Wallet at ≥ 80 % of declared session budget. | Bond/wallet check on every cost-accrual write. | Spawner (block new spawns from this wallet); operator. | session, project | 0.8 | **event** | false | `budget:reset`, `session:done` | glyph_only |
| **`urgency:overdue`** | Work claimed but no progress note past TTL. | Heartbeat sweep: claim age > TTL × 1.5 with no recent note. | Salvage agent; operator; the claim-holder's own context broker. | session, file-claim | 0.7 | **1800 s** (30m) | true | `note:posted`, `session:done`, `claim:released` | glyph_only |

### Reputational / quality — "facts *about the code* that age slowly"

These are the kinds the typing rule cuts closest on. They look like facts; they are **stored as facts in tuples and feedback**, and a pheromone is sprayed *as a side-effect* whose only job is to gate attention. The pheromone fades; the tuple stays. The half-lives here are intentionally long: a file that broke tests yesterday is still suspicious today.

| name | meaning | when to spray | who cares | target | init | half-life | idle decay | clear events | role |
|---|---|---|---|---|---|---|---|---|---|
| **`experience:succeeded`** | Last `done` on this target was a success. | `pd done` with `status=success` (sugar.ts done path). | Spawner (prefer "fertile ground"); approvers. | file, symbol, project | 0.6 | **172800 s** (48h) | **false** | `experience:failed` on same target, `experience:reverted` | glyph_only |
| **`experience:failed`** | Last `done` was a failure with stated reason. | `pd done --fail` or auto-fail from cost cap / timeout. | Spawner (avoid re-trying without context); operator. | file, symbol, session | 0.7 | **86400 s** (24h) | **false** | `experience:succeeded` on same target | glyph_only |
| **`experience:reverted`** | Work on this target was reverted in a later commit. | Cartographer or git-hook detects revert against a prior `done`. | Approvers; postmortem agent; planners. | file, region | 0.7 | **604800 s** (7d) | **false** | manual `pd pheromone clear`, `git:resolved` tuple | glyph_only |
| **`quality:test-failing`** | Tests touching this target are red in current HEAD. | CI / pre-commit hook reports failure; mapping via test-to-source index. | All fleet agents (don't ship); operator; dashboard. | file, symbol, project | 0.9 | **event** | **false** | `quality:tests-green` for this target | **always_visible** |
| **`quality:test-flaky`** | Tests touching this target have a flaky history (≥ 2 failures, ≥ 1 pass, in last 20 runs). | Test-runner rollup job. | QA agent; spawner (don't dispatch flake-chasers here). | file, symbol, project | 0.5 | **259200 s** (3d) | false | `quality:flake-resolved` tuple | glyph_only |
| **`freshness:stale-doc`** | A doc here references a deleted or renamed symbol. | Cartographer's symbol-mention diff job. | Documentarian agent; operator on doc landings. | file (doc) | 0.4 | **604800 s** (7d) | false | `doc:updated`, target symbol restored | glyph_only |
| **`dependency:upstream-changed`** | An upstream module of this target changed since this was reviewed. | Approver-tooling diff hook on PR open / `pd review` request. | Approvers; reviewer agents. | file, symbol | 0.6 | **86400 s** (24h) | false | `review:approved` on this target | glyph_only |

### Coordination — "who's bumping into whom right now"

| name | meaning | when to spray | who cares | target | init | half-life | idle decay | clear events | role |
|---|---|---|---|---|---|---|---|---|---|
| **`claim:contested`** | Another agent attempted to claim while held. | Claim-rejection path in session-files. | Both agents (negotiate); operator (detect deadlock). | file, region, symbol | 0.8 | **180 s** (3m) | true | `claim:released`, `claim:handed-off` | drives_color |
| **`salvage:pending`** | Session is entering resurrection; the work on this target is salvageable. | Salvage daemon detects abandoned session with non-empty diff. | Salvage operators; opportunistic agents. | session, file | 0.7 | **event** | false | `salvage:claimed`, `salvage:dismissed`, `salvage:expired` | glyph_only |
| **`group:overlap-detected`** | Two or more sessions claim adjacent / overlapping regions of this target → implicit working group. | Overlap detector cron (Phase 3 work, but spray hook can land earlier). | All members of the implicit group; operator. | file, region, project | 0.5 | **600 s** (10m) | true | `group:dissolved`, `group:materialized` | glyph_only |

### Why these 18 and not 14 or 24

The catalog is the floor at which the typing rule holds without forcing every kind through a single bottleneck. Smaller than ~14 and you start jamming distinct intentions into one slot (`experience:failed` swallowing `quality:test-failing` loses the *who-cares*: a test-failure interests every agent; a `done --fail` interests the spawner specifically). Larger than ~22 and you exceed the operator's working memory for what each color/glyph means — the bivariate-choropleth research (`.scratch/pheromone-visualization-research.md` § 3, "More than two channels reliably degrades into 'mud'") sets the practical ceiling. Eighteen is the seam that holds.

---

## 3. Decay model — per-kind half-life with activity gating

### 3.1 Formula

For a pheromone with current value `v`, half-life `h` (seconds), and time-since-last-decay-tick `dt` (seconds):

```
v_new = v * (0.5 ^ (dt / h))
```

This is the standard half-life formula (`v_new = v · 2^(-dt/h)`). It generalizes the current single-rate path in `lib/pheromone.ts:65` (which uses `value * config.decayRate` per fixed `intervalMs` tick) by binding the effective decay rate to the kind, not to a global config.

**Sub-cutoff drop.** When `v_new < 0.01`, delete the key from the metadata blob — matches the current cutoff in `lib/pheromone.ts:86-87` and keeps the read path cheap.

**Read-time decay.** `decayOnRead` (`lib/pheromone.ts:139`) is the right place to compute this per-kind: the function already takes the pheromones dict; the change is to look up `h` per `key` instead of using `config.decayRate ^ intervals`. The background `evaporate()` tick (`lib/pheromone.ts:65`) becomes a *fallback* sweep so stale entities don't accumulate cruft — semantics for live readers are set by `decayOnRead`.

### 3.2 Activity-gating algorithm

```
function shouldDecay(kind, lastFleetActivityTs, now):
  if kindMeta[kind].decay_during_idle == true: return true
  if (now - lastFleetActivityTs) < IDLE_THRESHOLD_S (default 60): return true
  return false
```

`lastFleetActivityTs` is the most recent of: any `pd note`, any `pd session` write, any spray, any successful spawn IPC turn. The daemon already tracks this for the bosun heartbeat — reuse, don't add a new field.

**Why activity-gating matters.** Vibe coding is bursty. The operator opens the laptop at 2 pm, fights three files for an hour, walks the dog. If `hot:editing` decays during the walk, when they come back the heat tree shows "everything is cold," which is misleading and operator-hostile. The half-life is meant to model **fleet-time**, not wall-time. Reputational kinds (`experience:*`, `quality:*`, `freshness:stale-doc`) are explicitly `decay_during_idle=true` because they describe **the code**, which keeps existing whether the fleet is awake or not. Coordination and topological kinds (`hot:editing`, `recent:touched`, `claim:contested`, `urgency:overdue`, `cost:burning`) are explicitly `decay_during_idle=false` for the inverse reason — they describe **the session**, which is paused when the fleet is idle.

`attention:human-blocked` and `budget:nearing-cap` and `salvage:pending` use **`half-life: event`**, i.e. they don't decay on a timer at all. They live until a `clear_events` tuple resolves them. A human is blocked or not blocked; there is no "half-blocked." Same for budget caps and salvage opportunities.

### 3.3 Defending the half-life choices (six exemplars)

- **`hot:editing` = 300 s.** A claim refresh ticks every 60-90 s in current fleet wiring; five minutes is two refreshes plus headroom. Sprayer: claim-refresh hook in `lib/sessions.ts`. Reader: heat-tree color (Mode A). Longer (say 30 min) and the tree lights up files the agent finished an hour ago; shorter and the tree flickers between refreshes.
- **`recent:touched` = 900 s.** The "I was working here recently" softer signal. 15 min lines up with the spawner's adjacency-preference window in the dispatch heuristics. Sprayer: `session.files.add`. Reader: spawner.
- **`cost:burning` = 600 s.** Cost-burn is a derivative metric; you want it to cool faster than a budget cap (which is a level metric and uses `event`). Sprayer: bond-accrual hook in `lib/bonds.ts`. Reader: budget enforcer, dashboard.
- **`urgency:overdue` = 1800 s.** A claim past TTL with no note for 30 min is "actually overdue" rather than "operator stepped away." Sprayer: heartbeat sweep. Reader: salvage agent.
- **`experience:succeeded` = 48 h.** Yesterday's win is still good ground. Two days out it should fade unless re-validated. Sprayer: `pd done` success path. Reader: spawner ("fertile ground").
- **`experience:reverted` = 7 d.** A revert is the longest-lived signal in the catalog: it doesn't just say "the thing failed," it says "the thing failed AND a human or higher agent overturned the original judgment." That's a property of the code we want hanging around. Sprayer: cartographer / git-hook revert detector. Reader: approvers, postmortem.

### 3.4 What "event" half-life means in storage

The current pheromone storage is JSON metadata on rows (`lib/pheromone.ts:80-95`). To support event-cleared kinds without changing the schema in v1, the kind metadata table (sibling lookup, in-memory const) flags `half-life: 'event'` and `decayOnRead` simply skips the multiplicative step for those keys. The kind is removed only when one of its `clear_events` fires — a thin tuple-subscription on `tuples.in(pattern)` in the same module.

---

## 4. Composition rules — primacy axis & glyphs

### 4.1 The primacy axis: urgency-weighted

**Color is driven by a single composite scalar — the urgency-weighted blend of `attention:human-blocked`, `quality:test-failing`, and `cost:burning`.**

```
urgency(target) = max(
  1.00 * attention:human-blocked,
  0.95 * quality:test-failing,
  0.85 * cost:burning
)
```

These are the same three kinds that take the **`always_visible`** composition role in the table above. The choice is not arbitrary: these three are the only kinds the operator must drop everything to look at. Everything else — what's hot, what's been touched, who succeeded yesterday — is browseable, not actionable in the next sixty seconds.

**Why urgency and not "activity":** an "activity" axis (sum of topological + coordination kinds) lights up the heat tree exactly when the fleet is working as expected. That makes the visualization a *busyness gauge* instead of a *trouble gauge*, and it trains the operator to ignore color — the exact failure mode Datadog calls out in their heatmap engineering blog (reserve red for failure-class events). The urgency axis stays cold when things are routine and goes hot precisely when intervention is the right move. This is the Datadog "skip-red-for-routine-activity" principle made into a hard rule.

**Why three kinds and not five:** adding `urgency:overdue` and `budget:nearing-cap` to the blend was tempted but rejected. Overdue is downstream of human-blocked (operator unblocks the human; the overdue clears). Budget-nearing-cap is downstream of cost-burning. Folding them in would double-count and would create a flickering color whenever both a base kind and its derivative kind are active. The three chosen are mutually independent at the level of operator action.

**Hysteresis.** Per the visualization research, the dominant-kind switch uses a hysteresis band: the runner-up must exceed the leader by `> 0.10` for `≥ 2` decay ticks before the color swaps. Implements as a per-target two-slot history in the pheromone read path; cheap.

### 4.2 Glyph mapping (one canonical glyph per kind)

| kind | glyph | rationale |
|---|---|---|
| `hot:editing` | `⚡` | matches existing CLI rendering at `cli/commands/pheromone.ts:154-178` |
| `cold:abandoned` | `🪦` | salvage candidate, distinct from "just stale" |
| `flow:hot-path` | `↯` | critical-path lightning, distinct from edit-lightning |
| `recent:touched` | `·` | low-weight breadcrumb |
| `attention:human-blocked` | `🛑` | operator's eye must catch this |
| `cost:burning` | `$` | matches existing cost-burn hint in viz research mock |
| `budget:nearing-cap` | `≈$` | level metric, distinct from rate metric |
| `urgency:overdue` | `⌛` | hourglass; orthogonal to dollar signs |
| `experience:succeeded` | `✓` | minimal, doesn't shout |
| `experience:failed` | `✗` | inverse of success; danger-red tint |
| `experience:reverted` | `↩` | unlike failure, indicates *judgment was overturned* |
| `quality:test-failing` | `⚠` | matches viz research mock at `.scratch/pheromone-visualization-research.md:67` |
| `quality:test-flaky` | `~⚠` | adjacent to failing but lesser |
| `freshness:stale-doc` | `📜` | doc-specific, never on code targets |
| `dependency:upstream-changed` | `△` | "look upstream"; triangle pointing up |
| `claim:contested` | `🔥` | matches viz research conflict glyph at `.scratch/pheromone-visualization-research.md:75` and `cli/commands/pheromone.ts:154-178` |
| `salvage:pending` | `⚓` | harbor / salvage motif |
| `group:overlap-detected` | `⌬` | benzene-ring of agents; defer if too noisy |

**Glyph budget per tile (per viz research § 2 Mode A):** 3 max. Always-visible kinds (`🛑`, `⚠`, `$`) reserve the first three slots when present. Tiles smaller than 40 px render no glyphs; the dominant-kind hue alone carries the signal. The legend in Mode D is the disambiguator.

### 4.3 Color palette (hue per kind family, lightness per strength)

Pheromone colors extend `tokens.semantic.css` under a new `--pheromone-*` block — single source of truth for web + FleetBar (`PDTokens.swift`) + CLI ANSI:

- **Topological:** warm amber (`hot:editing`, `flow:hot-path`, `recent:touched`); slate-gray for `cold:abandoned`.
- **Economic:** danger-red for `cost:burning`; deeper danger-red for `budget:nearing-cap`; cobalt for `attention:human-blocked` (Datadog-trained: blue for "human attention", not "danger"); ochre for `urgency:overdue`.
- **Reputational positive:** sage green for `experience:succeeded`. Reputational negative: danger-red for `experience:failed`; deep danger-red for `experience:reverted`; ochre for `quality:test-failing`; muted ochre for `quality:test-flaky`. Documentarian: sandstone for `freshness:stale-doc`. Dependency: pale teal for `dependency:upstream-changed`.
- **Coordination:** red-orange for `claim:contested`; ebony for `salvage:pending`; pale teal for `group:overlap-detected`.

Lightness ramps from `--surface-0` at `strength = 0.01` to the saturated token at `strength = 1.0`.

---

## 5. Spray hook table — who sprays what, when

Cross-references to existing files where the hook will land (Phase 2 work, `pheromone-spray-wiring` slug). The table is the contract a downstream PR can implement against.

| kind | spray site (file:symbol) | trigger |
|---|---|---|
| `hot:editing` | `lib/sessions.ts` claim-refresh handler | on `session.files.add` and on every claim refresh tick |
| `cold:abandoned` | `lib/salvage.ts` (existing salvage scan) | on session-TTL detection of unclaimed work |
| `flow:hot-path` | new rollup in `lib/pheromone.ts` cron tick | when distinct-agent-touches ≥ 3 in 1 h on same target |
| `recent:touched` | `lib/sessions.ts` `session.files.add` | on every claim creation (lower init than hot:editing) |
| `attention:human-blocked` | `lib/inbox.ts` post handler when channel matches `inbox:human` | on inbox post; clear on `inbox:human:resolved` |
| `cost:burning` | `lib/bonds.ts` accrual hook | when 10-min rolling cost > threshold |
| `budget:nearing-cap` | `lib/bonds.ts` wallet check | on every cost accrual write when ratio ≥ 0.8 |
| `urgency:overdue` | bosun heartbeat sweep (`lib/bosun.ts`) | on heartbeat tick when claim past 1.5× TTL with no note |
| `experience:succeeded` | `lib/sugar.ts` `done()` success path | on `pd done` with success status |
| `experience:failed` | `lib/sugar.ts` `done()` failure path | on `pd done --fail` or auto-fail (timeout / cost) |
| `experience:reverted` | cartographer git-hook (`apps/cartographer/`) | when revert commit lands against a prior `experience:succeeded` target |
| `quality:test-failing` | CI hook + local pre-commit (new) | on test-runner failure with file-mapping output |
| `quality:test-flaky` | test-history rollup job | scheduled, looks at last 20 runs per file |
| `freshness:stale-doc` | cartographer symbol-mention diff | when symbol referenced in a doc gets deleted/renamed |
| `dependency:upstream-changed` | approver-tooling diff hook on PR open | on `pd review` request or PR-open webhook |
| `claim:contested` | `lib/sessions.ts` claim-rejection path | on rejected `session.files.add` (file already claimed) |
| `salvage:pending` | salvage daemon | when abandoned session has non-empty diff |
| `group:overlap-detected` | overlap-detector cron (Phase 3) | on detection of two sessions claiming adjacent regions |

Every spray site already exists or is a single function-level addition. None require new tables or new pub/sub channels.

---

## 6. Sniff API enrichment — what `pd sniff` returns per kind

The current `sniff()` (`lib/pheromone.ts:187-202`) returns `{ success, pheromones: { [key]: number } }`. That is the right wire format for the daemon-internal path but it is information-poor for the actual consumers. Viz research Mode E (`.scratch/pheromone-visualization-research.md:174-201`) specifies the enriched read shape; this section locks the per-kind contract that lives downstream of the kind catalog.

For each kind, when present on a target, the enriched response surfaces:

```json
{
  "kind": "hot:editing",
  "value": 0.86,
  "rank": "high",
  "trend": "rising",
  "age_s": 240,
  "half_life_s": 300,
  "decays_during_idle": true,
  "sprayed_by": "session-foo-...",
  "advice": [
    "claim is fresh; another agent likely still editing — coordinate via inbox before editing"
  ]
}
```

**Per-kind advice strings** (deterministic, no LLM, one or two lines per kind):

- `hot:editing` high + recent → "claim is fresh; coordinate via inbox before editing"
- `claim:contested` any value → "this file is contested right now; prefer a region/symbol claim over whole-file"
- `attention:human-blocked` any value → "an agent is waiting on the operator here; don't dispatch parallel work that depends on this resolution"
- `cost:burning` high → "spawn here will compound a cost spike; pause or de-spawn"
- `quality:test-failing` any value → "tests on this target are red; do not ship without addressing"
- `experience:reverted` any value → "previous work on this target was reverted; read the revert commit before re-attempting"
- `experience:failed` recent → "last attempt failed; read the fail note before re-spawning"
- `freshness:stale-doc` any → "doc references a symbol that no longer exists; doc edit required, not a code edit"
- `dependency:upstream-changed` any → "an upstream module changed since this was last reviewed; re-validate before approval"
- `salvage:pending` any → "abandoned work salvageable here; consider claiming via `pd salvage`"
- `group:overlap-detected` any → "implicit working group detected on this target; check `pd whois` for peers"

Kinds without bespoke advice (`recent:touched`, `flow:hot-path`, `cold:abandoned`, `urgency:overdue`, `budget:nearing-cap`, `experience:succeeded`, `quality:test-flaky`) return no `advice` array. Silence is honest: not every kind needs an opinion.

**Dominant kind** (per § 4 primacy axis) is surfaced as a sibling field, with the urgency score:

```json
{
  "dominant": "attention:human-blocked",
  "urgency_score": 1.0,
  "always_visible": ["attention:human-blocked", "quality:test-failing"]
}
```

Where `always_visible` lists which always-visible kinds are currently active (regardless of dominance).

---

## 7. Open questions / deferred to v2

These were considered and deliberately not added to the v1 catalog:

1. **`security:secret-exposed`** — detected secret in this file. Belongs in feedback + tuples, but might want a pheromone for "raise this above hot:editing in the heat tree right now." Deferred because the spray site (secret-scanner) isn't built and the kind risks duplicating the always-visible budget. Revisit when secret-scanning lands.
2. **`relevance:user-pinned`** — operator explicitly pinned this file as relevant to the current goal. Pheromone-shaped (decays if not refreshed) but blurs with feedback (pin is a fact, not graded attention). Likely belongs in tuples with a sidecar always-visible synthetic pheromone derived from the tuple. Defer until DOM-lasso annotation lands in Phase 3.
3. **`reachability:from-current-claim`** — graph-distance from whatever you're editing; pure visualization aid. Tempting but it isn't a *signal* from anywhere — it's a *projection* of the symbol graph. Belongs in the renderer, not the substrate.
4. **`historical:churn-30d`** — CodeScene-style hotness over a month. Real signal, but the time horizon makes it a metric, not a pheromone (decay doesn't apply meaningfully at 30-day scale). Store as a precomputed column on the symbol-index, not as a sprayed pheromone.
5. **`group:explicit-formed`** — sibling to `group:overlap-detected` for groups the operator explicitly named. Deferred to Phase 3 along with the rest of the explicit-group surface.
6. **Per-actor reputational kinds** — e.g. `experience:agent-succeeds-here` indexed by actor + target. Useful for the phonebook / `pd whois`, but the read pattern is "agent → target", not "target → pheromone-on-target." Belongs in the agent-experience index, not the pheromone substrate.
7. **Co-dominance interpolation** — when two kinds are within 0.05, blending hues instead of switching is tempting (visually smoother). Rejected for v1 because it reintroduces visual mud. Revisit if operator testing shows the hysteresis approach feels jumpy.
8. **`decay_curve` per kind** — current model uses pure exponential. Some kinds may want stepped decay (full strength for N seconds, then fall) — e.g. `attention:human-blocked` could ramp up instead of being binary. v2 work; the `half-life: 'event'` escape hatch covers the binary case for v1.

---

## 8. Worked examples — five scenarios end-to-end

Each scenario walks through what the substrate looks like, which kinds appear on which targets, what the heat-tree color shows, and what `pd sniff` returns. These are the contract checks an implementer can use as fixtures.

### 8.1 Two agents racing the same file

`session-A` adds `lib/sugar.ts` to its claim set. `session-B` tries to add it three seconds later, gets rejected.

State after 5 s:
- `lib/sugar.ts` carries `hot:editing = 0.9` (sprayed by `session-A`'s claim hook), `recent:touched = 0.4`, and `claim:contested = 0.8` (sprayed by `session-B`'s rejection path).
- Urgency axis = `max(0, 0, 0) = 0` → heat-tree color comes from `claim:contested` (drives_color role) at moderate intensity.
- Glyphs: `🔥 ⚡ ·` (contested, editing, recent-touch breadcrumb).
- `pd sniff files lib/sugar.ts` returns advice "this file is contested right now; prefer a region/symbol claim over whole-file" and lists both kinds with rank `high` (contested) and `high` (editing).

State after 4 min (240 s) with no further activity, fleet still active:
- `hot:editing` decayed: `0.9 · 2^(-240/300) ≈ 0.52`.
- `claim:contested` decayed: `0.8 · 2^(-240/180) ≈ 0.32`.
- `recent:touched` decayed: `0.4 · 2^(-240/900) ≈ 0.33`.
- Heat still legible; contested has lost its primacy. Glyph budget keeps `⚡` and `🔥`.

State after `session-A` calls `pd done --success`:
- `clear_events` for `hot:editing` includes `session:done` → drops to 0.
- `experience:succeeded` sprayed at 0.6 with 48 h half-life. Tile shifts to sage green, glyph `✓`.

### 8.2 An agent posts to `inbox:human` and waits

`session-C` hits a `human-gate` checkpoint at line 412 of `routes/spawn.ts`.

State:
- `attention:human-blocked` sprayed at 1.0 on the session row (target type: session). Half-life: `event`.
- `urgency(target) = max(1.00 * 1.0, ...) = 1.0` → heat tree on the session lights up at peak.
- FleetBar popover tile shows `🛑 1 human-blocked`. Web dashboard sidebar pings.
- `pd sniff sessions session-C` advice: "an agent is waiting on the operator here; don't dispatch parallel work that depends on this resolution."

If 25 minutes elapse without resolution:
- The bosun heartbeat sweep fires `urgency:overdue = 0.7` (because TTL is typically 20 min, 25 min > 1.5×TTL? actually no — recheck: 20 × 1.5 = 30, so not yet). At 30 min mark, `urgency:overdue` sprays.
- Glyph stack on the session row: `🛑 ⌛`. Heat unchanged (already at 1.0).
- Operator clicks "resolve" in FleetBar → `inbox:human:resolved` tuple fires → `attention:human-blocked` cleared to 0 → `urgency:overdue` also clears (its clear list includes `note:posted` which the resolution writes).

### 8.3 Tests go red on a hot file

`session-D` lands a change on `lib/pheromone.ts`. CI runs and reports two failing tests touching that file.

State:
- Before CI: `lib/pheromone.ts` has `hot:editing = 0.7` (cooling from earlier edit). Color: amber, low.
- CI hook fires `quality:test-failing = 0.9` on `lib/pheromone.ts`. Half-life: `event`.
- Urgency `= max(0, 0.95 * 0.9, 0) = 0.855`. Color shifts to ochre/red. Glyph `⚠` reserved.
- `pd sniff` advice: "tests on this target are red; do not ship without addressing."
- Approver agent reading the file gets a non-empty `advice` array on its very first sniff — no extra round-trip needed.

When the tests turn green (next CI run):
- `quality:tests-green` tuple fires for the same target. `quality:test-failing` cleared. Color returns to whatever `hot:editing` and other glyph-only kinds dictate.

### 8.4 A revert, two weeks later

Cartographer detects that commit `abc123` reverts commit `xyz789`, which had `experience:succeeded` on `lib/pheromone.ts` 12 days ago.

State:
- `experience:succeeded` already decayed to ~0 (48 h half-life with `decay_during_idle=false` but the fleet has been active most of those 12 days).
- `experience:reverted = 0.7` sprayed on `lib/pheromone.ts`. Half-life: 7 d, `decay_during_idle=false`.
- Glyph: `↩`. Color shifts to deep danger-red at moderate intensity (reverted is glyph_only by role, so it doesn't drive primacy color — but the tile's *dominant* fallback when no urgency-axis kind is active does favor the highest-strength glyph_only kind for legibility).
- Approver opening `pd sniff files lib/pheromone.ts` two days later sees value ≈ `0.7 * 2^(-2/7) ≈ 0.57` with advice "previous work on this target was reverted; read the revert commit before re-attempting."

This is the longest-lived non-event kind. It outlives most sessions and most operator memory; that's the point.

### 8.5 Implicit working group forms

Three sessions claim adjacent regions of `routes/spawn.ts`: lines 110-145, 160-188, 200-240.

State:
- Each region gets `hot:editing` per claim (region target type).
- Overlap detector cron fires `group:overlap-detected = 0.5` on the *file* (not the regions), at half-life 600 s with `decay_during_idle=true`.
- Glyph on the file tile: `⌬` in glyph_only slot. Color driven by aggregated `hot:editing` (since no urgency-axis kind is active).
- Any of the three agents that calls `pd sniff files routes/spawn.ts` gets advice "implicit working group detected on this target; check `pd whois` for peers."
- The group is *implicit*: no row in the `groups` table is created; the pheromone is the surface. If the operator promotes it to an explicit group, `group:materialized` clears the pheromone and a real group row appears.

---

## 9. Storage & migration notes

The current pheromone storage (`lib/pheromone.ts:80-95`) is JSON metadata on rows. The v1 catalog does not require schema changes:

- **Key vocabulary lives in code, not in DB.** A `lib/pheromone-kinds.ts` constant maps each kind name to its metadata (half-life, idle-decay flag, composition role, glyph). The DB stores only the kind name and the strength.
- **Backward compatibility.** Existing pheromones already in production (lib/pheromone.ts has been live since v3.0) use ad-hoc keys like `heat`, `churn`, `cost_burn`. These do not collide with any v1 kind name (no `:` separator). The v1 reader treats unknown keys as kind `legacy:<name>` with default half-life = current global rate, idle-decay = true, glyph_only role. A one-shot migration script can rename `heat` → `hot:editing`, `churn` → `flow:hot-path`, `cost_burn` → `cost:burning` (these are the only three currently sprayed in production per a grep of the lib/ tree).
- **`pheromone_events` table** (for the time-series view from viz research Mode C) is *not* required for v1. It is a Phase 2 concern (`heat-tree-viz` slug). The vocabulary doc is independent of that storage choice.
- **Validation at spray time.** `lib/pheromone.ts:113` (`spray`) gains a kind-name check against the v1 catalog. Unknown kinds get a soft warn-log (not a hard reject) for the first release window, then become hard rejects in the version after the catalog stabilizes. Soft mode protects in-flight fleet scripts.

---

## 10. Cross-reference summary

- Three typing rules → `docs/ROADMAP.md` § 8 (PR #108).
- Five visualization modes + multi-kind composition prior art → `.scratch/pheromone-visualization-research.md` (PR #108).
- Decay implementation (single-rate today, per-kind after this doc lands) → `lib/pheromone.ts:18, 65, 86-87, 113, 139`.
- Spray surface (HTTP) → `routes/pheromone.ts:46`; CLI → `cli/commands/pheromone.ts:154-178`.
- Existing conflict glyph → `cli/commands/pheromone.ts:154-178`; preserved as `🔥` for `claim:contested`.
- Facts and feedback (the alternatives a kind must defend itself against) → `lib/tuples.ts:40`, `lib/feedback.ts:142`.
- Always-visible color tokens — extend `tokens.semantic.css` + `apps/FleetBar/FleetBar/PDTokens.swift` (new `--pheromone-*` block).

This doc locks the vocabulary. Implementation lands in `pheromone-decay-per-kind` (Phase 2) and `pheromone-spray-wiring` (Phase 2), per `docs/ROADMAP.md` § 8 phased sequencing.
