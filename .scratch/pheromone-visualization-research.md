# Pheromone Visualization — Prior Art & Design Proposal

**Status:** research / proposal
**Author:** Researcher subagent (2026-05-19)
**Reviewers:** operator + whichever agent picks this up
**Source under study:** `lib/pheromone.ts`, `cli/commands/pheromone.ts`, `routes/pheromone.ts`, existing dashboard heatmap stub in `public/index.html:784-794`

The pheromone substrate already exists. It works. What is missing is a visualization that two distinct audiences — *AI agents reading state programmatically* and *human operators steering the swarm* — can both use to answer the same question: **"where is the swarm right now, what is it spending, and what is failing?"**

This doc surveys prior art, proposes five visualization modes, addresses the multi-kind composition problem honestly, names PD's actual rendering surfaces, and lists the tradeoffs that need operator input.

---

## 1. Prior art survey

### Code-level spatial visualization

| Tool | What it does | Lesson for PD |
|---|---|---|
| **CodeScene Hotspots** | Treemap/circle-packed file tree where size = LOC and color intensity = "hotness" (change frequency × code health). Click a hotspot, drill to function-level X-ray. | Two metrics composed (size×heat). Severity uses a single red gradient; CodeScene does NOT try to encode N metrics in one color — it stacks them as separate views accessible via tabs/cached perspectives. ([CodeScene Hotspots docs](https://docs.enterprise.codescene.io/latest/guides/technical/hotspots.html), [Behavioral Code Analysis](https://codescene.com/product/behavioral-code-analysis)) |
| **CodeCity / CodeCharta** | 3D city metaphor: classes as buildings, packages as districts, height = complexity, footprint = size, color = coupling. Tasks completed 20% faster than baseline. | Useful for *architecture* understanding; overkill for ephemeral swarm state. We want a 2D treemap, not a city. ([CodeCity paper](https://wettel.github.io/codecity.html), [CodeCharta](https://github.com/MaibornWolff/codecharta)) |
| **Gource** | OpenGL force-directed graph of repo tree; contributors as avatars touching files; pulse of light on commit. Animated history. | The *animation of touch events* is the part PD should steal for the live view. Force-directed layout is too unstable for a status surface — file positions should be deterministic. ([Gource](https://gource.io/)) |
| **GitHub Punchcard / contribution calendar** | 2D grid (day × hour OR week × day) with a single sequential color ramp. | Dead simple, instantly legible. PD's *temporal* view of pheromones per file is essentially this. ([GitHub Punchcard](https://github.com/vnau/punchcard)) |
| **GitLens / VSCode blame gutter** | Inline annotations next to lines, color-tinted gutter strips, inlay hints between tokens. Minimap shows error/warning markers in a separate gutter. | The *in-context overlay* idiom. PD agents reading `pd sniff <file>` should see this kind of dense, in-context annotation when they open the file in their IDE — but it's an aspirational MCP surface, not v1. ([VSCode theme colors](https://code.visualstudio.com/api/references/theme-color), [minimap source](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/viewParts/minimap/minimap.ts)) |
| **Sourcegraph batch-change preview** | List of affected repos/files with diff stats, before-apply review surface. Code intel hovers distinguish "semantic" vs "search-based" precision. | The *precision indicator* matters: a pheromone of strength 0.9 set 30 seconds ago is qualitatively different from one decayed to 0.9 from an old 1.0 spike. Tag every reading with provenance. ([Sourcegraph Batch Changes](https://sourcegraph.com/docs/batch-changes)) |
| **Flame graphs** | Stack-frame width = sample count, color hue randomized (warm palette) to differentiate adjacent boxes, optional hue mapping for "code type" dimension. | Brendan Gregg's explicit guidance: random warm hues are *not* an encoding — they're a *separator*. A second dimension can use hue (Java=green, kernel=orange) but you get one extra channel, not five. ([The Flame Graph, ACM Queue](https://queue.acm.org/detail.cfm?id=2927301)) |
| **Datadog heatmap & host map** | Light-blue → purple → orange ramp, deliberately skipping red to avoid "alert" affordance unless something is actually wrong. Host map = 2D grid of squares, color = single metric, size = constant. | Reserve red for *failure-class* pheromones (`experience:failed`, `quality:test-failing`). Don't burn red on "hot:editing" or you train operators to ignore it. ([Datadog heatmap engineering blog](https://www.datadoghq.com/blog/engineering/how-we-built-the-datadog-heatmap-to-visualize-distributions-over-time-at-arbitrary-scale/), [Heatmap widget docs](https://docs.datadoghq.com/dashboards/widgets/heatmap/)) |

### Swarm / stigmergy academic prior art

Ant Colony Optimization (ACO) simulators visualize pheromone trails as edge-weighted graphs where edge thickness or opacity encodes deposited pheromone, and a separate animation layer shows agent positions. Recent multi-agent RL frameworks ([2510.03592](https://arxiv.org/pdf/2510.03592), [Sciencedirect — Virtual Stigmergy](https://www.sciencedirect.com/science/article/pii/S016764231930139X)) explicitly overlay a "virtual pheromone map" as a 2D grid on top of the agent environment for human inspection — same idea PD needs, applied to the file tree instead of a physical grid.

Key academic finding: **pheromone visualization is most useful as a *gradient field*, not as discrete point readings.** Agents (and humans) are reasoning about *which way the slope goes*, not about absolute values. PD should expose `pd sniff` output in a way that makes the local gradient legible (neighbor comparison, parent rollup), not as a context-free scalar.

### Multi-metric composition prior art

Bivariate choropleth maps (the 3×3 color grid: low-low through high-high) are the cleanest two-metric solution. [Studying the Separability of Visual Channel Pairs in Symbol Maps (arxiv 2602.20022)](https://arxiv.org/html/2602.20022) tested channel pairs and found:

- **color × shape** is most *separable* (viewers can read each independently)
- **size × orientation** is *least* separable
- More than two channels reliably degrades into "mud"

**Implication:** PD must pick one *primary* pheromone dimension per view and use shape/glyphs/badges for the others — not try to cram 15-20 kinds into hue alone.

---

## 2. Five visualization modes for PD's substrate

### Mode A — Heat tree (recursive treemap over file tree)

The flagship view. Files are leaves; directories aggregate; whole repo is the root rectangle. **This is what the operator opens to answer "where is the swarm?"**

**Aggregation rule (proposed):** `max` for the headline number, `sum` for capacity/budget pheromones (`cost:burning`, `attention:human-blocked` count), kept *per-kind* all the way up — never collapsed to one scalar at the directory level. The leaf carries the kind that produced its color; the parent carries the *dominant* kind among its descendants weighted by max-strength.

Why `max` not `sum`: a directory with one file at heat=0.9 and ninety files at heat=0.0 is qualitatively a hot directory (someone is fighting over a file in there). Summing dilutes the signal; averaging hides outliers. `max` preserves the "there's a fire in this room" semantics. Use a small badge (the count) next to the max to expose "how many leaves contribute."

**ASCII mock:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ port-daddy/                                            heat 0.94  ●●●●  │
│ ┌─────────────────────────┬──────────────────────┬──────────────────┐   │
│ │ lib/         heat 0.94  │ routes/     0.71     │ cli/    0.42     │   │
│ │ ████████████████████▓▓  │ ███████████▓▓░░      │ ██████░░░░       │   │
│ │ ┌──────────┬──────────┐ │ ┌────────┬─────────┐ │ ┌──────┬───────┐ │   │
│ │ │ sugar.ts │ db.ts    │ │ │ spawn  │ sugar.ts│ │ │spawn │ note  │ │   │
│ │ │  0.94 🔥 │  0.40    │ │ │  0.71 ⚠│  0.60   │ │ │ 0.42 │ 0.30  │ │   │
│ │ │  $0.18   │  edit:1  │ │ │  test✗ │ edit:2 ⚡│ │ │      │       │ │   │
│ │ └──────────┴──────────┘ │ └────────┴─────────┘ │ └──────┴───────┘ │   │
│ │ pheromone.ts  0.86 ⚡⚡  │ pheromone.ts 0.55 ⚡ │ pheromone 0.40   │   │
│ └─────────────────────────┴──────────────────────┴──────────────────┘   │
│ apps/  0.31 ░░    docs/ 0.18 ░    tests/ 0.55 ░░░    public/ 0.10       │
└─────────────────────────────────────────────────────────────────────────┘

Legend: ●●●● dominant kind = hot:editing   ⚡ active claim   🔥 conflict
        ░░▓▓██ heat ramp                   ⚠ test-failing    $ cost burn
```

The *headline color* is the dominant kind's color (warm orange for `hot:editing`, deep red for `experience:failed`, cobalt for `attention:human-blocked`). The *secondary kinds* are surfaced as **glyphs** in the corner of each tile — not as additional colors. This is the bivariate-choropleth lesson: encode one dimension in color, others in shape.

**Implementation notes:**

- Layout: squarified treemap (D3 `d3.treemap().tile(d3.treemapSquarify)`) — same algorithm CodeCity uses.
- Size of each tile: file LOC (or constant=1 for an MVP).
- Color: dominant pheromone kind's hue, lightness = magnitude.
- Glyphs: render up to 3 secondary-kind icons in the bottom-right of each tile when there's room. Don't render any if the tile is <40px.
- Click a directory → zoom in. Click a file → open the AST-level overlay (Mode B).

### Mode B — AST-level overlay (function/symbol heat within a file)

Once `lib/symbol-index.ts` lands (already built, just not wired per MEMORY.md), files get sub-divided into symbols. This view answers "*which function* inside `server.ts` is the swarm fighting over?"

**ASCII mock:**

```
server.ts                                                 heat 0.86 ⚡⚡⚡
├─ imports (lines 1-42)                                   ░░       cold
├─ function bootstrap() (lines 44-89)                     ███▓░    0.62
│   └─ claim: agent=spider-3, since 14:32                 ⚡
├─ function registerRoutes() (lines 91-201)               ████████ 0.94 🔥
│   ├─ claim: agent=lookout-2, lines 110-145, since 14:28 ⚡
│   └─ claim: agent=navigator-1, lines 160-188, since 14:30 ⚡
│       ↳ OVERLAP RISK (lines 145-160 unclaimed, both editing nearby)
├─ function shutdown() (lines 203-218)                    ░        cold
└─ exports (lines 220-end)                                ▓░       0.20
```

Two pheromones-on-symbols become legible here:

- `hot:editing` per symbol is the bar fill.
- Active file-region claims show as ⚡ markers with agent attribution.
- Conflict (two claims with overlapping or near-overlapping ranges) is a 🔥, exactly what `pd pheromone files` already surfaces at file granularity in `cli/commands/pheromone.ts:154-158`.

**Zoom levels:**

1. Treemap zoom (Mode A) → file is a tile, hide symbols.
2. File zoom → show symbol-level bars (this mode).
3. Symbol zoom → show line-by-line if we ever wire blame-style annotation. Not v1.

### Mode C — Time-axis view (per-file sparkline strip)

Pheromones decay. A snapshot tells you the current temperature; a sparkline tells you *which way the fever is moving*. This is the Tufte-sparkline / GitHub-punchcard idiom applied to swarm state.

**ASCII mock:**

```
Hot files — last 60 min                                  (now → past, 1px = 30s)

lib/sugar.ts          0.94  ▁▁▂▃▄▅▆▇█████████████▇▆▅▄▃▂▁▁     hot:editing
lib/pheromone.ts      0.86  ▁▁▁▂▃▄▆█▇▆▅▄▃▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁     hot:editing  spike 18m ago
routes/spawn.ts       0.71  ▁▂▃▄▅▆█▇▅▄▃▂▂▁▁▁▁▂▃▄▅▆▇████▇▆     test-failing  re-flared
docs/recovery/...     0.55  █▇▆▅▄▃▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁     cooling
lib/db.ts             0.40  ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂     steady
```

The sparkline encodes:

- **Shape:** rising / falling / steady / re-flared (cooled then heated again — important coordination signal: "another agent came back to this file after the first left")
- **Color of sparkline:** the *dominant pheromone kind during that window*, not the latest one. If a file was `hot:editing` for 30 minutes then `experience:failed` for the last 5, the sparkline shifts hue along its length. This is the flame-graph "extra dimension via hue" trick.

**Storage need:** today's `metadata.pheromones` is a snapshot, not a time series. We'd need either:
- a `pheromone_events` table (every spray creates a row) — cheap, scannable, decays by retention not by math, or
- a time-bucketed rollup table written by the evaporation tick.

Operator decision: option A is simpler and lines up with the existing activity-log pattern; option B is faster to query.

### Mode D — Operator dashboard tile (one-screen swarm summary)

For FleetBar popover and the web console sidebar. *Glanceable*, not interactive. The "I'm in another window and want to peek" view.

**ASCII mock (FleetBar popover panel, ~360px wide):**

```
┌────────────────────────────────────────────────┐
│  Swarm Heat                          ●●●● 0.94 │
│  ────────────────────────────────────────────  │
│  3 hot files · 2 conflicts · 1 burning $       │
│                                                │
│  lib/sugar.ts       ████████████▓░  0.94 🔥    │
│  lib/pheromone.ts   ███████████▓░░  0.86       │
│  routes/spawn.ts    █████████▓░░░░  0.71 ⚠     │
│                                                │
│  Top kind: hot:editing  (3 of 3)               │
│  Cost burn: $0.18 in last 10m  (acceptable)    │
│  Human-blocked: 0                              │
│                                                │
│  [ Open heat tree → ]                          │
└────────────────────────────────────────────────┘
```

Three rows max. The "Top kind" line is the crucial composition disambiguator: if everything is `hot:editing` then the heat means "lots of work happening" (fine). If two files are `hot:editing` and one is `experience:failed` then a glance tells the operator "something is *actually* on fire, not just busy." This is the Datadog "skip-red-for-routine-activity" principle.

### Mode E — Agent-facing read interface (`pd sniff` enriched)

When an *agent* calls `pd sniff files server.ts`, today it gets `{ heat: 0.6, churn: 0.42 }`. That's a useless scalar bag — the agent has no idea whether 0.6 is hot or cold, recent or stale, dominant or one of many.

**Proposed structured response:**

```json
{
  "target": { "table": "files", "id": "server.ts" },
  "pheromones": {
    "hot:editing":      { "value": 0.94, "rank": "high",   "trend": "rising",  "age_s":  90 },
    "experience:failed":{ "value": 0.40, "rank": "medium", "trend": "steady",  "age_s": 600 },
    "cost:burning":     { "value": 0.18, "rank": "low",    "trend": "falling", "age_s": 300 }
  },
  "dominant": "hot:editing",
  "neighbors": {
    "siblings_above_median": ["lib/db.ts", "lib/sugar.ts"],
    "parent_rollup": { "lib/": { "max_kind": "hot:editing", "max_value": 0.94 } }
  },
  "advice": [
    "high contention — consider symbol-region claim rather than whole-file",
    "another agent edited this 90s ago; coordinate via inbox before re-editing"
  ]
}
```

Critical: **rank** (low/medium/high) is the swarm-relative percentile, not a raw scalar — solves the "is 0.6 a lot?" problem. **trend** is computed from the last N evaporation ticks (needs the time-series storage from Mode C). **advice** is the smallest amount of *opinionated* guidance that turns the read into an action — pure scalars are too cheap to be useful at agent-call sites.

Cost: returning advice from a scalar-only DB hit is a few `if` statements, not an LLM call. Keep it deterministic.

---

## 3. The multi-kind composition problem — honest treatment

PD has ~15-20 kinds of pheromones across topological (hot/cold), economic (cost/attention), and reputational (experience/quality) dimensions. They co-occur. **Naively summing is misleading; per-kind RGB tinting becomes visual mud.**

### Strategy 1 — Dominant kind + glyphs (preferred default)

Color the tile/bar by the *dominant kind's hue* (kind with highest strength on that target). Render other kinds as small badges/glyphs in the corner.

**Failure modes:**
- **Co-dominance:** two kinds at exactly 0.85 — the dominant choice flickers as decay nudges them past each other. *Mitigation:* hysteresis — only switch dominant if the runner-up exceeds the leader by >0.1 for >2 ticks.
- **Important-but-not-dominant kinds get hidden:** `attention:human-blocked` at 0.3 next to `hot:editing` at 0.9 — the human-block is *categorically* more important even though it's numerically smaller. *Mitigation:* a small set of "always-visible" kinds (human-blocked, test-failing, cost over budget) that get *guaranteed* glyph real estate regardless of dominance.

This is roughly what CodeScene does — they have *multiple perspectives* the user can cache and switch between, not one master color encoding.

### Strategy 2 — Bivariate choropleth on the two most important axes

Pick two axes: "activity" (sum of topological+economic kinds) and "trouble" (sum of reputational+blocking kinds). Map to a 3×3 color grid (low-low through high-high). This is the cartography-classic move; it survives perceptual testing better than 3+ channel encoding.

**Failure modes:**
- **Axis choice is editorial.** The operator (or PD) must decide which kinds load onto "activity" vs "trouble." Get this wrong and the map becomes meaningless.
- **Loss of resolution within an axis.** 0.3 + 0.3 + 0.3 looks like 0.9 even though it's a fundamentally different state. Mitigate by surfacing axis composition on hover.

### Strategy 3 (rejected) — RGB channel per kind

Cyan = topological, magenta = economic, yellow = reputational. Visually clever, perceptually disastrous. CMY summing produces unreadable browns when all three are active — exactly the "everything is on fire" state where readability matters most. **Don't do this.** The bivariate choropleth paper and the channel-separability arxiv work both predict failure here.

### Recommendation

Default to **Strategy 1 (dominant + glyphs)** with the always-visible reserved-kinds set. Offer **Strategy 2 (activity vs trouble)** as a togglable "operator perspective" the way CodeScene offers cached perspectives. Never ship Strategy 3.

---

## 4. Rendering surfaces in PD (concrete file map)

Same pheromone data, four surfaces. Each one renders the *appropriate subset* of the five modes above.

| Surface | File path | Renders | Why |
|---|---|---|---|
| **Web console (active)** | `fleet-config-ui/src/components/` — needs a new `PheromonePanel.tsx`, sibling to `UsageTelemetryPanel.tsx`. API client extension goes in `fleet-config-ui/src/api.ts`. | Modes A (heat tree), B (AST drill-down), C (time-axis), D (sidebar tile) | The Vite/React app served at `/fleet-ui/` is now the canonical operator surface (per the banner in `public/index.html:807-816`). Add a "Swarm Heat" route. |
| **Legacy dashboard** | `public/index.html:784-794` + `:1390-1450` | Mode D only — keep the existing "Pheromone Heat Map" panel; freeze it. | Deprecated per the legacy banner. Don't extend, but don't break the existing top-8-files panel either. |
| **FleetBar popover** | `apps/FleetBar/FleetBar/FleetPopover.swift` (1381 lines, plenty of room for one more SwiftUI section). Tokens already exist via `PDTokens.swift`. | Mode D only — one tile in the popover stack. | Menu bar app needs a *glance*, not a heat tree. Reuse the new `/pheromone/files?depth=1` endpoint. |
| **CLI** | `cli/commands/pheromone.ts` (already has `pd pheromone files` rendering an ASCII heat bar — `:154-178`). Add `pd pheromone tree [--path] [--depth]` for Mode A in ANSI, and `pd pheromone history <file>` for Mode C sparklines. | Modes A (ASCII treemap), C (ASCII sparkline), E (rich `pd sniff` output) | Agents use the CLI more than humans do here; the structured-JSON path for Mode E is the high-leverage one. |
| **TUI (future)** | The `core/pd-tui/` Rust crate doesn't exist yet (per `ls`), only the design mocks in `docs/design/tui-mocks.html`. When it lands, it should render Mode A (heat tree) as a navigable ratatui widget. | Modes A, C, D | Defer until the Rust TUI actually exists. |
| **MCP** | `mcp/server.ts` — add `sniff_target` and `swarm_heat_summary` tools that return Mode E payload and Mode D payload respectively. | Modes D, E | Agents read this through MCP, not by parsing CLI text. JSON shape from Mode E is the contract. |

**Data flow:** all surfaces hit the same daemon route. Today `routes/pheromone.ts` exposes `/pheromone/files` and `/pheromone/spray`. To support the modes above we need three new endpoints:

- `GET /pheromone/tree?path=&depth=` — returns the recursive aggregated tree (Mode A).
- `GET /pheromone/history/:table/:id?window=60m` — returns the time series (Mode C). Requires the storage decision from §2 Mode C.
- `GET /pheromone/sniff/:table/:id` — returns the enriched Mode E payload (replaces the bare `metadata.pheromones` read).

Aggregation lives in the daemon, not the client. Every surface gets the same numbers; only the rendering differs.

---

## 5. Tradeoffs & open questions for the operator

### Decisions the operator needs to make

1. **Aggregation rule for directories: max, sum, or per-kind hybrid?**
   - Recommendation: per-kind, with `max` headline. But this depends on whether the operator thinks "lots of small heat" or "one big fire" is the worse state.

2. **Time-series storage: events table vs rollup table?**
   - Recommendation: events table (`pheromone_events`), 24h retention, queried with `WHERE target = ? AND ts > ?`. Lines up with the existing activity log pattern.
   - Cost: writes scale with spray frequency. With 8 fleet agents at ~1 spray/minute each, that's ~12k rows/day — trivial for SQLite.

3. **Reserved "always-visible" kinds list.**
   - Strawman: `attention:human-blocked`, `quality:test-failing`, `cost:over-budget`. Operator should confirm or extend.

4. **Per-kind color palette — bind to existing PD design tokens?**
   - `PDTokens.swift` and `tokens.semantic.css` already define cinnabar / sandstone / ebony. The pheromone palette needs ~6 distinct hues (one per "kind family"); should it pull from the same token set or introduce a pheromone-specific palette?
   - Recommendation: extend `tokens.semantic.css` with a `--pheromone-*` block; reuse cinnabar for `experience:failed`, ebony-tint for `cold:abandoned`, etc. Single source of truth.

5. **Is the heat tree a default tab or a tucked-away view?**
   - The dashboard tile (Mode D) should be on the operator landing page. The full heat tree (Mode A) is opt-in — it's information-dense and not useful unless something is interesting.

### Things to just pick (no operator input needed)

- Treemap layout: squarified.
- Sparkline width: 30 chars / 60 minutes (1 cell ≈ 2min).
- Hysteresis on dominant-kind selection: switch only if runner-up < leader − 0.1 for ≥ 2 ticks.
- Glyph budget per tile: 3 max, always render the reserved-kinds glyphs first.

### Open / out-of-scope

- **Per-line gutter overlay in the user's IDE.** Beautiful, but requires an MCP-driven editor extension. Park it.
- **3D Gource-style animated history.** Cinematic, low utility per pixel. Skip.
- **LLM-generated natural-language swarm summary.** Possible from Mode D data, but adds latency and a cost-burn pheromone of its own. Park behind a feature flag.
- **AST-level claims.** Mode B assumes `lib/symbol-index.ts` is wired — per MEMORY.md it's built but not wired into `server.ts`. Mode B is blocked on that.

---

## 6. Recommended build order

1. Backend: `GET /pheromone/tree` endpoint with recursive aggregation in daemon. Deterministic, testable. *No UI changes yet.*
2. Backend: `pheromone_events` table + write hook in `spray()` + retention sweep. Enables Mode C.
3. CLI: `pd pheromone tree` ASCII renderer (low-cost win, dogfoodable today).
4. CLI: enrich `pd sniff` to Mode E shape; update MCP `sniff_target` tool.
5. Web: `PheromonePanel.tsx` in `fleet-config-ui/` — Mode D tile + drill-through to Mode A treemap.
6. FleetBar: SwiftUI section in `FleetPopover.swift` — Mode D only.
7. Web: Mode C sparkline strip.
8. (Blocked) Mode B AST overlay — wait for `symbol-index.ts` wiring.

Each step is independently shippable. Steps 1-4 cost a couple days; the visual modes (5-7) are where most of the design polish lives.

---

## Sources

- [CodeScene Hotspots documentation](https://docs.enterprise.codescene.io/latest/guides/technical/hotspots.html)
- [CodeScene Behavioral Code Analysis](https://codescene.com/product/behavioral-code-analysis)
- [CodeCity 3D visualization (Wettel)](https://wettel.github.io/codecity.html)
- [CodeCharta on GitHub](https://github.com/MaibornWolff/codecharta)
- [Gource](https://gource.io/)
- [GitHub PunchCard](https://github.com/vnau/punchcard)
- [VSCode theme color reference](https://code.visualstudio.com/api/references/theme-color)
- [VSCode minimap source](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/viewParts/minimap/minimap.ts)
- [Sourcegraph Batch Changes docs](https://sourcegraph.com/docs/batch-changes)
- [The Flame Graph (ACM Queue, Gregg)](https://queue.acm.org/detail.cfm?id=2927301)
- [Datadog heatmap engineering blog](https://www.datadoghq.com/blog/engineering/how-we-built-the-datadog-heatmap-to-visualize-distributions-over-time-at-arbitrary-scale/)
- [Datadog heatmap widget docs](https://docs.datadoghq.com/dashboards/widgets/heatmap/)
- [Pheromone-Focused ACO path planning (arxiv 2601.07597)](https://arxiv.org/pdf/2601.07597)
- [Deep RL for multi-agent coordination (arxiv 2510.03592)](https://arxiv.org/pdf/2510.03592)
- [Multi-agent systems with virtual stigmergy (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S016764231930139X)
- [Studying the Separability of Visual Channel Pairs in Symbol Maps (arxiv 2602.20022)](https://arxiv.org/html/2602.20022)
- [Bivariate Hue Blending — Springer](https://link.springer.com/chapter/10.1007/978-3-031-61698-3_9)
- [Tufte on sparklines](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)
- [Juice Analytics — Small Multiples](https://www.juiceanalytics.com/writing/better-know-visualization-small-multiples)
