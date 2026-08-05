# SHIPWRIGHT — Master Design Spec

> *"A shipwright does not decide where the voyage goes. A shipwright decides what the vessel
> can survive."* — working epigraph

**Status:** Spec — 2026-04-19
**Owner:** Erich Owens
**Scope:** The Shipwright agent + its UI + the FleetControl hardening that must land first
**Informed by skills:** `swiss-modern-website-design`, `high-quality-vibe-coding`,
`neobrutalist-web-designer`, `data-viz-2025`, `ostrom-commons-governance`,
`klein-1998-sources-of-power`, `tlaplus-practitioner`, `agentic-zero-trust-security`,
`design-accessibility-auditor`, `animation-system-architect`, `design-system-creator`,
`vitest-testing-patterns`

---

## 0. Why this exists

Port Daddy has all the primitives a multi-agent system needs: ports, sessions, notes,
locks, pheromones, a tuple space, agent registry, merge queue, symbol index, fleet
runner, cost tracker. What it *lacks* is a thoughtful architect who walks into a repo
and proposes the right fleet. Today users write `pd-fleet.yml` by hand — most never do.

**Shipwright** is the meta-fleet-architect:

1. **Surveys** your code (and PRDs, vision docs, git history, Sentry hooks, CI logs) to
   understand intent.
2. **Proposes** a tailored fleet of agents (triggers, prompts, skills from
   `~/coding/wrkgroup-ai`, models, budgets, bonds).
3. **Simulates** an hour of that fleet's life so you can see, before spending a dollar,
   exactly what 30 commits / N file-touches / M notes / $X of spend would look like.
4. **Harbors** the resulting fleet under FleetControl, with real bond escrow and real
   budget kill-switches — no theater.

It is exposed via **CLI first**, **FleetBar second**, **Dashboard third**. Same data
source, three surfaces.

---

## 1. The three tracks (order is load-bearing)

| Track | What lands | Why first / later |
|-------|-----------|-------------------|
| **1. FleetControl hardening** | Bond escrow, hard budget kill, dry-run FleetRunner, concurrency semaphore, Arbiter slashing. Full tests. | Without this, simulations are theater and production fleets are a liability. The user explicitly called this out. |
| **2. Shipwright survey/propose/simulate** | CLI commands + daemon routes. Haiku/Opus pass. Skill retrieval from `~/coding/wrkgroup-ai` via embeddings (never keyword lists). Dry-run output is structured JSON. | Track 3 is impossible without a real data backend to render. |
| **3. UI — Harbor view, Focus mode, Simulation canvas, Shipwright Chat, FleetControl Panel** | React + existing `website-v2` tokens. 21st.dev builds leaf components. FleetBar gets a compact variant. Neobrutalist-Swiss throughout. | Needs tracks 1 & 2. |

Do not merge them out of order. Each track ends with: green tests, a demo, a
CHANGELOG entry, stable-branch promotion (`./scripts/promote-stable.sh`).

---

## 2. Mental model — Shipwright's internal loop

```
                                ┌─────────────────────────────┐
                                │        wrkgroup-ai          │
                                │  500+ skills, embedded      │
                                └───────────┬─────────────────┘
                                            │ cosine retrieval (never keywords)
 root folder ───► SURVEY ──► intent ──► PROPOSE ──► pd-fleet.yml.proposed ──► SIMULATE ──► events.json
                    │           │          │                                      │
                    │           │          │                                      └─► UI renders
                    │           │          │                                          ghosts → ships
                    │           │          ▼
                    │           │     bond & budget envelope from FleetControl
                    │           ▼
                    │        episodic memory + tuples (prior proposals, outcomes)
                    ▼
              manifest detection (lib/detect.ts, 60+ frameworks)
              project health (git age, test pass rate, doc staleness,
                              Sentry alert volume, CI red rate)
```

This is Klein's RPD (recognition-primed decision) model: Shipwright pattern-matches
the repo against its episodic memory of prior fleets, simulates the first plausible
proposal mentally, and only searches further if the simulation fails acceptance
gates (budget, bond, coverage). That's why we keep episodic memory of past
survey→propose→outcome triples.

---

## 3. CLI surface (the contract)

All commands emit both human output (default) and structured JSON (`--json`) so the
UI reads the same bytes as you do.

```
pd shipwright survey <root>            # writes docs-agnostic project survey JSON
                                       #   per project found under <root>
  --depth 3                            # how deep to walk (default 3)
  --refresh                            # ignore 24h cache
  --json                               # emit structured output to stdout

pd shipwright propose <project>        # returns pd-fleet.yml.proposed
  --model haiku|sonnet|opus            # model tier for the proposer itself
  --budget-usd-per-day 5               # envelope Shipwright must propose within
  --bond-ceiling-usd 2                 # max bond Shipwright can require per agent

pd shipwright simulate <project>       # runs the proposed fleet in dry-run mode
  --hours 1                            # simulated wall clock
  --speed 60                           # simulation:wall ratio
  --seed 42                            # reproducibility
  --sse                                # stream events instead of batch JSON

pd shipwright apply <project>          # writes pd-fleet.yml from .proposed
                                       #   after human-reviewed diff
  --diff                               # show diff, do not write
  --force                              # skip confirmation

pd shipwright chat <project>           # opens REPL-style chat with Shipwright,
                                       #   grounded in that project's survey
```

Every one of these is also available as an HTTP endpoint under `/shipwright/*` on
the daemon, so FleetBar and the dashboard use identical wire formats.

---

## 4. Survey — what Shipwright actually reads

Shipwright's survey is **cheap** (Haiku) and **rigorous**. It emits one JSON object
per discovered project.

### 4.1 Inputs (per project)

| Source | What we extract | How |
|---|---|---|
| `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` | Language, framework, scripts | `lib/detect.ts` already does this |
| `README.md`, `CLAUDE.md`, `docs/**/*.md`, `PRD*.md`, `VISION*.md`, `ROADMAP*.md` | Intent, purpose, delivery medium, status | Haiku summarization (~$0.001 per project) |
| `.git` log last 90d | Activity rate, contributors, hot files, staleness | `git log --numstat` |
| `pd-fleet.yml` | Existing fleet, if any | Direct read |
| `port-registry.db` | Registered services, past sessions, past violations | SQL |
| `sentry.config.*`, `.env*`, `.github/workflows` | Signals Shipwright can wire triggers to | File heuristics (structured fields only) |
| `tsconfig.json`, `.eslintrc`, test configs | Quality posture (strict? coverage?) | Structured config reads |

### 4.2 Output shape (`shipwright.survey.json`)

```jsonc
{
  "project": "port-daddy",
  "root": "/Users/erichowens/coding/port-daddy",
  "surveyedAt": "2026-04-19T07:52:24Z",
  "classification": {
    "kind": "server-daemon",         // server-daemon | web-app | mobile | lib | cli | site
    "languages": ["typescript"],
    "frameworks": ["fastify", "react", "vite"],
    "deliveryMedium": "npm + launchd + homebrew tap",
    "uiSurfaces": ["dashboard (public/index.html)", "FleetBar (SwiftUI)", "CLI"]
  },
  "intent": "Authoritative port manager + multi-agent coordination daemon.",
  "purpose": "Deterministic ports, sessions/notes, pheromones, tuple space, fleet agents.",
  "status": {
    "activity": "hot",               // hot | warm | cool | cold
    "commitsLast30d": 127,
    "openPRs": 3,
    "testSuites": 52,
    "testsPassing": true,
    "ciRed": false,
    "docFreshness": "current",
    "hasFleet": true,
    "fleetSizeAgents": 8,
    "sentryConfigured": false
  },
  "hotFiles": ["server.ts", "lib/fleet-engine.ts", "lib/cost-tracker.ts"],
  "risks": [
    "Bond/budget enforcement is advisory-only",
    "Dashboard has only 38% parity with routes",
    "Fleet simulation mode not yet implemented"
  ],
  "opportunities": [
    "Typesafety sweep on routes/",
    "Doc sync between CLAUDE.md / README / features.manifest",
    "Performance regression agent on merge queue hot path"
  ],
  "costHintUsdPerDay": 1.80,
  "confidence": 0.82
}
```

The UI's **Harbor view** renders one ship per survey object. Ship *class* maps from
`classification.kind`. Ship *size* maps from LOC or `commitsLast30d`. Ship *color* maps
from `status.activity`. Ghost ships = surveyed but no fleet yet.

---

## 5. Propose — the bounded search

Proposing a fleet is **not** free-form code generation. It is a bounded selection from:

- **Skills**: retrieved from `~/coding/wrkgroup-ai` via embeddings + cosine similarity.
  Never keyword-matched (global rule).
- **Agent archetypes** (below) — 12 canonical roles, each with a prompt template,
  default skills, default trigger grammar, default model tier.
- **Triggers** — a closed grammar (below).
- **Budgets & bonds** — sampled from the project's risk profile.

### 5.1 Twelve canonical agent archetypes

| Name | Purpose | Default trigger | Default model | Default bond | Default hourly cap |
|---|---|---|---|---|---|
| **Gardener** | Remove deprecated code, tighten types | daily cron | haiku | $0.10 | $0.50 |
| **QA Sentinel** | Run tests on every PR, triage failures | git push / PR open | sonnet | $0.25 | $1.00 |
| **Test Gap Hunter** | Find uncovered branches, propose tests | weekly cron | sonnet | $0.20 | $0.75 |
| **Documentarian** | Sync README / CLAUDE.md / manifest | on doc drift (file-watch) | haiku | $0.10 | $0.30 |
| **Simplifier** | Propose refactors that reduce LOC | weekly cron | sonnet | $0.30 | $1.00 |
| **Research Scout** | Scout external inspo, file as tuples | weekly cron | haiku | $0.05 | $0.20 |
| **Dock Master** | Orchestrate launches, check health | on service claim | haiku | $0.05 | $0.20 |
| **Spark** | Long-form strategy / vision refresh | monthly cron | opus | $1.00 | $2.00 |
| **Sentry Responder** | Jump on production errors | Sentry webhook | sonnet | $0.50 | $2.00 |
| **Perf Hawk** | Detect perf regressions on hot paths | CI duration delta > 20% | sonnet | $0.30 | $1.00 |
| **Browser Canary** | Playwright hot-path checks on site deploys | post-deploy webhook | sonnet | $0.25 | $0.75 |
| **Typesafety Sweeper** | Remove `any`, tighten generics | on file change matching `**/*.ts` | haiku | $0.10 | $0.40 |

Shipwright's job in **propose** is: given a survey, select 3–8 archetypes, tune
their parameters to the project, attach the top-k retrieved skills from
wrkgroup-ai, and emit `pd-fleet.yml.proposed`. Three is the minimum useful fleet;
eight is the ceiling before attention fragments.

### 5.2 Trigger grammar (closed)

```
trigger:
  kind: cron | git-push | git-pr | file-watch | sentry-webhook
      | deploy-webhook | ci-duration | service-claim | tuple-pattern | manual
  # kind-specific fields:
  cron: "0 * * * *"                     # for kind: cron
  paths: ["src/**/*.ts"]                # for kind: file-watch
  webhook: "https://...", secret: "..."  # for kind: *-webhook
  tuple: ["alert", "prod", "*"]         # for kind: tuple-pattern
```

A closed grammar means FleetControl can enforce that trigger handlers are real code,
not arbitrary shell.

### 5.3 Proposed YAML shape (extends existing `pd-fleet.yml`)

```yaml
fleet:
  version: 2
  proposedBy: shipwright
  proposedAt: 2026-04-19T07:52:24Z
  limits:
    max_concurrent_spawns: 2
    max_spawns_per_hour: 20
    budget_usd_per_day: 5
    bond_ceiling_usd: 2            # NEW — hard cap on any single agent's bond

agents:
  - id: qa-sentinel
    archetype: qa-sentinel          # NEW — archetype lineage for diffing
    backend: claude-cli
    model: sonnet
    bond_usd: 0.25                  # NEW — escrowed before spawn
    budget_usd_per_day: 1.00        # NEW — per-agent ceiling
    trigger: { kind: git-pr }
    skills:                         # NEW — explicit skill attachment
      - vitest-testing-patterns
      - high-quality-vibe-coding
    prompt: |
      You are the QA Sentinel for port-daddy...
    rationale: |
      Selected because the repo has 52 test suites, strict TS on, and
      frequent PRs from background fleet agents. High ROI on early
      failure detection.
```

`rationale` is non-optional. If Shipwright can't say why an agent is in the fleet,
that agent is not in the fleet. This is Ostrom's "monitoring" principle: each
participant must justify its presence.

---

## 6. Simulate — how we make theater honest

This is the core UX promise: **you see the fleet run before it spends a dollar.**

### 6.1 Simulation engine

```ts
/**
 * Runs the proposed fleet in dry-run mode for a simulated wall-clock window.
 *
 * The simulator reuses the *real* FleetRunner from lib/fleet-engine.ts with
 * `dryRun: true` set. In dry-run mode:
 *   - Triggers fire according to their normal grammar, compressed to `speedRatio`.
 *   - Agents "spawn" but we never shell out — we synthesize plausible outputs
 *     from (archetype × project survey × skill list) using Haiku.
 *   - Cost is charged against a *virtual wallet*. No real $ move.
 *   - Every event — spawn, note, tool call, file write, commit, cost charge — is
 *     emitted on an SSE stream and persisted to simulations/<id>/events.ndjson.
 *
 * This matches what `lib/fleet-daemon.ts` does in production, minus the syscalls.
 * Tests verify that a `dryRun: true` FleetRunner produces zero child PIDs and zero
 * real cost debits against the project wallet.
 *
 * @example
 *   const sim = await simulate({ project: 'port-daddy', hours: 1, speed: 60, seed: 42 });
 *   for await (const ev of sim.events()) {
 *     console.log(ev.agentId, ev.kind, ev.payload);
 *   }
 *   // After completion:
 *   sim.summary();
 *   // => { commits: 3, fileWrites: 14, notes: 22, costUsd: 0.47, violations: 0 }
 */
```

### 6.2 Event taxonomy

```
agent.spawn          { agentId, archetype, bondEscrowedUsd }
agent.thinking       { agentId, chunk }                       // if thinking enabled
agent.tool           { agentId, tool, args, resultSummary }
agent.note           { agentId, sessionId, text, voice }      // voices from tokens.css
file.read            { agentId, path }
file.write           { agentId, path, linesAdded, linesRemoved, diff }
git.commit           { agentId, sha, message, files[] }
cost.charge          { agentId, usd, model, inputTokens, outputTokens }
bond.escrow          { agentId, usd }                         // pre-spawn
bond.refund          { agentId, usd }                         // clean exit
bond.slash           { agentId, usd, reason }                 // violation
arbiter.violation    { agentId, rule, severity }
agent.exit           { agentId, status, durationMs, totalCostUsd }
sim.tick             { simulatedTime, wallTime, costBurnRate }
```

The UI subscribes to this stream. Every event has an `agentId` so the UI can glow
that ship, animate that file in the file-tree, and accumulate cost in the gauge.

### 6.3 Reproducibility

Seed drives every random choice (which file a trigger fires on, which of two
equally-plausible actions an agent takes, latency jitter). Same seed → identical
event stream. This is critical for "tinker on an agent definition, re-run sim."

### 6.4 Acceptance gates on a simulation

Shipwright refuses to display a simulation as "ready to apply" if any gate fails:

- [ ] Total simulated cost ≤ `fleet.limits.budget_usd_per_day × 1.10`
- [ ] No `arbiter.violation` events
- [ ] No agent exceeds its `budget_usd_per_day`
- [ ] Concurrent spawns never exceed `max_concurrent_spawns`
- [ ] No two agents ever claim the same file symbol-range simultaneously
- [ ] Every `cost.charge` has a corresponding skill/tool justification

Failed gates → UI shows red warning strip, "Apply" button is disabled, Shipwright
proposes corrective edits.

---

## 7. UI — the harbor, the focus, the simulation

Everything below lives in `website-v2` tokens. No new palette. No new radii. No
soft UI. Reference is neobrutalist-Swiss: ink `#121212`, paper `#f2eee6`, blue
`#0055ff`, acid-lime `#dfff00`, Radnika sans, radius 0, shadow-raised hard,
no blur.

### 7.1 Harbor view (the default)

A Tufte small-multiple of projects, not a dashboard.

- **Grid**: 12 columns, 24px gutter, 8px baseline rhythm.
- **Ship cards**: rectangular, hard 2px black border, 5px offset hard shadow, radius 0.
- **Ship class as mark**: battleship (wide, tall), cruiser, frigate, sloop, ghost.
  Class determined by `classification.kind` × LOC. Glyph is a small inline SVG,
  *monochrome on ink*, never emoji.
- **Position**: projects sorted by activity recency, left-to-right, top-to-bottom.
  No free-form canvas — grid discipline is the point.
- **Motion**: rectilinear drift — each ship advances 1 grid cell every N seconds
  proportional to its commits-per-hour. Ships with no fleet idle.
  Max 120ms easing, `cubic-bezier(0.16, 1, 0.3, 1)`. No parallax, no bobbing.
- **Data ink**: ship size encodes LOC, opacity encodes staleness (fade over 30d
  of no commits), a tiny colored dot at the stern encodes fleet status (blue =
  active, lime = proposed, ink = none).
- **Keyboard**: arrow keys navigate, Enter enters Focus mode, / searches.

### 7.2 Focus mode

Click a ship → other ships fold away via shared-element transition (180ms, same
ease). The clicked ship scales into the top-left "command block." The rest of the
viewport splits into three zones:

```
┌───────────────────────────────────────────────────────────────────────┐
│  COMMAND BLOCK    │      SIMULATION CANVAS                            │
│  project meta     │      grid of ghost ships + live ships             │
│  intent one-liner │      file tree graph on the right edge            │
│  activity sparkline│                                                  │
│                   │                                                   │
│  [ Survey ]       │                                                   │
│  [ Propose ▾ ]    │                                                   │
│  [ Simulate ]     │                                                   │
│  model: ◉ Sonnet  │                                                   │
│                   │                                                   │
├───────────────────┼───────────────────────────────────────────────────┤
│  SHIPWRIGHT CHAT (collapsible drawer, 360px, right edge alt)          │
└───────────────────────────────────────────────────────────────────────┘
```

- **Model selector**: three hard-bordered pill buttons — `HAIKU` `SONNET` `OPUS`.
  Each shows $/hr delta vs. current. No soft toggle. Active = lime fill + ink
  text. Keyboard `1` `2` `3`.
- **Survey / Propose / Simulate** are the only three primary actions. They map
  1:1 to the CLI verbs. Secondary (Apply, Edit YAML, Diff) live behind a split
  button on Propose.

### 7.3 Simulation canvas

The canvas is a **grid-aligned staging field**. When the user hits Simulate:

1. Ghost ships materialize in their starting cells — hollow outlines, 30% opacity.
2. `sim.tick` begins. Each agent ship fills in (outline → filled black) when its
   first trigger fires.
3. On `file.write`, a line draws from the ship's stern to the file-tree node on
   the right. The file node glows (lime, 400ms fade) — this is the **pheromone
   signal**. Heavily-touched files retain a residual glow with geometric decay,
   matching the actual daemon's pheromone semantics.
4. On `git.commit`, a small monospace tag slides up from the ship:
   `+142 −8 · fix(merge): quiet reorder on empty queue`
5. On `arbiter.violation` or `bond.slash`, the ship gains a red corner stripe
   and halts.
6. Click any file node → side panel shows synthesized diff + the agent's notes,
   tool calls, thinking stream. All editable (prompt, archetype, skills). Edits
   live in the *proposal*, not the fleet — the simulation can be re-run with
   them with no side effects.

Animation grammar: no parallax, no spring physics, no scale bounce. Everything
is 180ms linear or `ease-out`. Swiss discipline > delight. Motion is *signal*.

### 7.4 Cost panel (Tufte, not dashboard)

Right-side fixed panel. One sparkline per agent (stacked small-multiples),
showing cost-per-simulated-minute. Sum line at top. Y-axis shared, x-axis labeled
once at the bottom. No gridlines, no gradients, no rounded bars. Annotation
callouts pull a leader line to expensive spikes: `sonnet · 42k in / 8k out · $0.14`.

### 7.5 Shipwright chat

Right drawer. Plain text. Radnika at `--text-base`. Shipwright's messages prefix
with a maritime signal voice (see `tokens.css`: mayday, pan-pan, securite, hail,
roger, wilco, report, over, out). Tool calls render as collapsible inline blocks.
Prompts are editable inline — hit Enter, re-simulate.

---

## 8. The FleetControl Panel (neobrutalist-Swiss control room)

Different surface, same tokens, *heavier* execution. This is the always-visible
bond/budget/violation HUD — the cockpit.

### 8.1 Layout

- Full-width 64px header: `FLEETCONTROL · PORT-DADDY · 07:52 UTC` in Radnika Black,
  tracking `-0.02em`, size `clamp(2.15rem, 3.8vw, 3.35rem)`.
- Three hard-bordered slabs side-by-side:
  1. **BUDGET** — vertical bar gauge. Filled from bottom in `--brand-primary`.
     At 80% the fill switches to `--brand-accent` lime. At 100% it flashes
     `--status-error` and the daemon-wide kill-switch arms.
  2. **BOND POOL** — horizontal stacked bar: escrowed / available / slashed.
     Each segment labeled in Radnika Medium, hard rules between segments.
  3. **VIOLATIONS** — table, 8px row height, monospace. Columns: agent, rule,
     severity, action-taken. Severity uses maritime voices.

- Below: per-agent row strip — one row per active/proposed agent. 40px height.
  - Left: archetype glyph + name.
  - Center: mini cost sparkline (last hour) and bond indicator.
  - Right: status chip (`ACTIVE` / `IDLE` / `THROTTLED` / `SLASHED` / `GHOST`).
  - Click → Focus mode for that agent within its project.

### 8.2 Neobrutalist-Swiss execution rules

- Everything has 2px ink border, 5px offset shadow, radius 0.
- Hover never softens — it shifts shadow to 2px (pressed state).
- No tooltips with drop shadow. Tooltips are hard-bordered text blocks.
- No color other than paper, ink, blue, lime, and the three status signals.
- Dark theme mirrors via `[data-theme='dark']` in existing tokens.
- All interactive states keyboard-reachable. Focus ring is 3px lime outline
  offset 4px (meets WCAG 2.2 focus-visible).

### 8.3 The Kill Switch

A single hard-bordered button, bottom-right, `PANIC · HALT FLEET`, mono capitals,
ink fill, lime text, 3px border. Click → two-step confirm dialog
(also hard-bordered). Arms daemon-wide `fleet.panic` tuple. Every FleetRunner
catches it and SIGTERMs its spawns. Recovery requires human unlock.

---

## 9. Data-viz decisions (Tufte discipline)

- **Cost breakdown**: stacked small-multiples per agent; never pie charts.
- **Ship activity**: sparkline per ship in Harbor view, 1px stroke, no fill.
- **Bond pool**: single horizontal bar, not donut.
- **Simulation timeline**: one vertical strip per minute, events as ticks,
  agent as color, violation as red X. Think "seismograph."
- **File heat**: opacity/saturation only; never 3D, never heatmap gradients.
- **Pheromone decay**: visible as opacity fade over time, matching the actual
  geometric decay in `lib/pheromone.ts`. The viz *is* the telemetry.

No chart uses more than two ink weights. Annotations win over legends.

---

## 10. Accessibility (non-negotiable, checked per build)

- Contrast ≥ 7:1 for body, ≥ 4.5:1 for meta in both themes.
- Focus ring on every interactive element (3px lime, 4px offset).
- All ship/archetype glyphs have `aria-label`.
- Simulation events also announced via `aria-live="polite"` region (rate-limited).
- Keyboard: harbor = arrows + Enter + /; focus mode = 1/2/3 (model), S (simulate),
  A (apply), Esc (back), ⌘K (command palette).
- No motion without `prefers-reduced-motion` fallback (ships snap, no drift).

Skill `design-accessibility-auditor` runs in CI against built HTML.

---

## 11. FleetBar integration

FleetBar (SwiftUI, `apps/FleetBar/`) gets a compact version:

- Menu bar icon: tiny filled ship glyph, tints to lime when fleet active, to red
  when kill-switch armed.
- Dropdown shows top 3 projects by activity. Click a project → opens dashboard
  Focus mode at the selected daemon (`eval "$(pd use <label>)"`, then
  `open "$PORT_DADDY_URL/focus/<project>"`).
- Live cost tick in the menu bar if user opts in (macOS-only).
- All data from `/fleet`, `/fleet/:project`, `/metrics/golden`. No new endpoints.

---

## 12. Bond, budget, and the commons (Ostrom)

Bonds are the single biggest mechanism-design change. Framing:

- **Every spawn must post a bond** proportional to its expected blast radius
  (file writes, network calls, cost ceiling). Stored in `bond_escrow` table.
- **Clean exit** = refund. **Budget overrun** = slash (portion or all). **Arbiter
  violation** = slash + quarantine. Slashed funds go to a `commons_pool`
  owned by the project, used to fund recovery agents and audits.
- This aligns with Ostrom's eight principles for commons governance:
  clearly defined boundaries (identity + bond), congruence of rules and local
  conditions (per-project limits), monitoring (Arbiter + violations table),
  graduated sanctions (throttle → slash → quarantine), conflict resolution
  (the merge queue + human override), minimal recognition (daemon authority),
  nested enterprises (project fleets within the daemon mesh).

The simulation shows *exactly* what would happen to each agent's bond in the
proposed hour. If bonds would all survive, Apply is enabled. If any would slash,
you see it before it happens.

Reference skill: `ostrom-commons-governance`.

---

## 13. Shipwright's own prompt (the meta)

```
You are Shipwright. You walk into a repo, read its intent, and propose the
smallest fleet that meaningfully reduces the user's future pain. You refuse
to propose an agent you cannot justify in one sentence. You never propose
more than 8 agents. You prefer cheap Haiku for narrow tasks, Sonnet for
judgment, Opus only for long-horizon strategy. You think like a shipwright,
not an admiral: your job is seaworthiness, not the voyage.

Inputs: {survey}, {skill_corpus_topk}, {user_overrides}, {budget_envelope}.
Output: a pd-fleet.yml.proposed that passes the simulator's acceptance gates.
If it does not, revise until it does — up to 3 attempts — then explain the
residual risk. Every agent must carry a bond, a budget, a trigger, and a
rationale. No agent exists without all four.
```

This lives in `prompts/shipwright.md`, versioned, editable by the user.

---

## 14. Open questions (for the archivist)

1. **Skill retrieval freshness.** Do we re-embed `~/coding/wrkgroup-ai` on every
   survey or nightly? (Leaning nightly, cached at `~/.port-daddy/skill-index.sqlite`.)
2. **Cross-project Shipwright.** If root contains 20 projects, does Shipwright
   propose a *fleet of fleets*? (V2. V1 is per-project only.)
3. **Thomas Youle's insurer auction.** Does FleetControl eventually replace bond
   with priced-by-market insurance? (Memory: `project_competitive_insurance`.)
4. **Symbol-level bonds.** Should large writes to hot symbols require larger
   bonds? (Likely yes, via `symbol-index`. V2.)
5. **Simulation trust.** How do we prevent Shipwright from synthesizing rosy
   simulations? (Seeded + replay from real episodic memory when available.)

---

## 15. Staging order (what lands, in what PR)

| PR | Title | Skill-informed | Lands |
|---|---|---|---|
| 1 | `feat(fleet): bond escrow schema + hard budget kill` | tlaplus, ostrom, vitest | Track 1a |
| 2 | `feat(fleet): dry-run FleetRunner + event taxonomy` | vibe-coding, vitest | Track 1b |
| 3 | `feat(shipwright): survey + propose + HTTP routes` | vibe-coding, klein-rpd | Track 2a |
| 4 | `feat(shipwright): simulate + SSE event stream` | vitest | Track 2b |
| 5 | `feat(dashboard): Harbor view + Focus mode (tokens-only)` | swiss-modern, a11y | Track 3a |
| 6 | `feat(dashboard): Simulation canvas + cost Tufte panel` | data-viz-2025 | Track 3b |
| 7 | `feat(dashboard): FleetControl Panel + Kill Switch` | neobrutalist | Track 3c |
| 8 | `feat(fleetbar): compact Shipwright surface` | design-system | Track 3d |

After PR 1 and PR 2: promote stable. Before PR 5: run the website-v2
`design-system-contracts.test.ts` to prove zero token drift.

---

*End of SHIPWRIGHT-DESIGN.md. Companion docs: `FLEETCONTROL-HARDENING.md`,
`COMPONENT-BRIEF.md`, `mocks/*.svg`.*
