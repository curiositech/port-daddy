# INGEST — Substrate / Pheromone / Multiplayer research → Operator TUI

> **Why this file exists.** Three open branches did the hard thinking about
> pheromone visualization, multiplayer signal-drop, and the pheromone lifecycle
> *before* the Operator-TUI vision was written down. The operator's read: it's
> "all sympatico AND relevant." This doc folds that research INTO the TUI track —
> cited, mapped to a TUI feature, and flagged built-vs-research — so the next
> agent doesn't re-derive what's already on a branch. Read
> [`VISION-OPERATOR-TUI.md`](./VISION-OPERATOR-TUI.md) first; this is its
> evidence locker.
>
> **House style.** First mention of a PD abstraction → bold + repo-relative
> source path. First mention of a primitive → what it is in one line. Every
> claim about what's-built cites a branch + path you can `git show`.

The four TUI surfaces this research lands on (the vision's words, my shorthand):

- **HEAT-FILETREE** — "lines and **words** heat-coded with recent agent attention
  and other pheromone traits."
- **ROLLED-UP HEAT-TREE** — "rolled-up tree visualizations of directories I can
  explore (zoom from repo → dir → file → line, heat aggregating up the tree)."
- **SIGNAL-DROP** — "I steer by dropping signals on the code … drop my own
  pheromones / tuples / notes to instruct my operator-avatar or guide the working
  agents."
- **MULTIPLAYER** — "multiplex into any agent … faster and more intuitive than
  tmux," plus more-than-one-human vibe-coding alongside the swarm.
- **HiTL** — "a beautiful, colorful top-of-app area for human-in-the-loop … that
  I can never miss."

---

## Source 1 — Pheromone Visualization research

**`.scratch/pheromone-visualization-research.md`** · branch
`origin/feat/pheromone-viz-design-v2` (open PR #231) — identical copy also on
`origin/docs/substrate-activation-2026-05-19` (332 lines, byte-for-byte; no need
to read both).

### 1a. The five visualization modes (the spine of the heat-filetree)

**The idea.** PD's pheromone substrate already works; what was missing is a way
to render hundreds of pheromone values legibly for two audiences at once (agents
reading programmatically, the operator steering). The research proposes five
modes: **A** heat-tree treemap, **B** AST/symbol-level overlay within a file,
**C** time-axis sparkline strip, **D** glanceable one-screen summary tile, **E**
enriched `pd sniff` JSON for agents. Each is mocked in ASCII and grounded in
prior art (CodeScene hotspots, Gource, GitHub punchcard, Datadog heatmaps, flame
graphs).

**Which TUI feature.** This is the **HEAT-FILETREE** and the **ROLLED-UP
HEAT-TREE** in one document — Mode A *is* the rolled-up dir viz, Mode B *is* the
"zoom to line/word" leaf level, Mode C is the time dimension the vision implies
when it says "alive," Mode D is the **HiTL** glance tile, Mode E is how the
operator-avatar and worker agents read the same substrate the human sees.

**Built vs research.** **Research-only**, but built on top of a *real* substrate.
The doc itself cites the live primitives: `lib/pheromone.ts`,
`cli/commands/pheromone.ts` (already renders an ASCII heat bar with a conflict
glyph at `:154-178`), `routes/pheromone.ts` (`/pheromone/files`, `/pheromone/spray`
exist today). The *visualizations* and the three new endpoints
(`/pheromone/tree`, `/pheromone/history/:table/:id`, `/pheromone/sniff/:table/:id`)
are proposed, not built.

**Concrete primitives to reuse.**
- `GET /pheromone/files` — already returns `(path, heat, agents, conflict)`; the
  TUI's first honest heat panel can read this *today* (satisfies the
  "honest-not-Potemkin" constraint without waiting on new endpoints).
- The **squarified treemap** layout (D3 `treemapSquarify` in the web spec) → in
  ratatui this is a recursive rectangle-split widget; deterministic positions
  (the doc explicitly warns *against* Gource-style force-directed layout for a
  status surface — file positions must be stable frame-to-frame).
- **Mode E enriched-sniff JSON shape** — `{ value, rank: low|med|high, trend,
  age_s, dominant, neighbors, advice[] }`. This is the contract the
  operator-avatar should consume; `rank` (swarm-relative percentile) is the part
  that turns a useless scalar into an action.

### 1b. The multi-kind composition problem (don't paint mud)

**The idea.** PD has ~18 pheromone kinds that co-occur. Naively tinting one color
per kind produces unreadable "mud." The research lands on **Strategy 1: dominant
kind drives hue, other kinds render as corner glyphs** (the bivariate-choropleth
lesson — color × shape is the most *separable* channel pair; >2 channels
degrades). With a reserved **always-visible** set (human-blocked, test-failing,
cost-over-budget) that gets guaranteed glyph real estate regardless of dominance,
plus **hysteresis** so the dominant color doesn't flicker as two kinds cross.

**Which TUI feature.** **HEAT-FILETREE** color/glyph rules, and the **HiTL**
"top kind" disambiguator (Mode D's "Top kind: hot:editing (3 of 3)" line is what
tells the operator "busy" vs "on fire").

**Built vs research.** Research-only (rendering policy), but it directly cites
the existing conflict glyph in `cli/commands/pheromone.ts:154-178` as the idiom
to extend.

**Concrete primitive to reuse.** The **Datadog rule** — *reserve red for
failure-class kinds only*, never for routine "hot:editing." This is load-bearing
for the vision's "colorful but legible": saturated palette, but red means
*intervene*, matching the HiTL "can never miss" requirement.

---

## Source 2 — Multiplayer Spatial Input research

**`.scratch/multiplayer-input-research.md`** · branch
`origin/feat/pheromone-viz-design-v2` (PR #231) — also byte-identical on
`origin/docs/substrate-activation-2026-05-19` (580 lines).

**The idea.** How do humans drop *spatial/contextual* signals into the swarm from
the surfaces they're already in (preview, docs, screenshots, filetree) without
inventing a sixteenth coordination mechanism? Author's thesis: PD already has the
substrate — **pheromones** (graded, decaying), **tuples** (`lib/tuples.ts`:
durable, queryable, pattern-subscribable typed facts), **`feedback`**
(`lib/feedback.ts`: typed human/agent annotations, already has a `source:'human'`
field), **harbors** (multi-tenant auth), **`agent_inbox`**, **`channels`**. The
work is *binding human surfaces into those primitives*, not inventing new ones.
Prior art surveyed: Figma frame-anchored comments + ephemeral cursor chat, Linear
inline comments, GitHub PR `(path, position)` comments with staleness, BugHerd's
*redundant anchors* (selector + xpath + text + bbox so one survives reflow),
click-to-component's DOM→source resolver, Yjs "agents-as-CRDT-peers."

**Which TUI feature.** This is the entire **SIGNAL-DROP** surface, plus the
**MULTIPLAYER** presence model. The vision's "annotate a function, a region, a
file, and the agents see it" is exactly this research's modality→primitive map.

**Built vs research.** Research/design proposal — explicitly "does not modify
code." But it's a *thin* proposal because the target primitives already exist:
`feedback.drop()`, `tuples.out()`, `pheromones.spray()`, `session_files` claims,
`coordination-route-guard.ts` / `coordination-acl.ts` for harbor isolation are
all live.

**Concrete primitives to reuse (the modality → PD-write map, verbatim intent):**

| Operator gesture in the TUI | PD write | Why this primitive |
|---|---|---|
| Drop a note on a **function/region** (SIGNAL-DROP) | `feedback.drop({surface:'<file>:<L1-L2>', source:'human'})` **+** `tuples.out(['file:annotation', id, {path, lines, quoted_text, comment, droppedBy, harbor}])` | feedback feeds Cartographer for free; tuple keeps raw spatial fidelity. *Two writes, one fact* — keeps Cartographer decoupled from UI detail. |
| "Look here more" on a **file** (heat-filetree right-click) | `pheromones.spray('files', <path>, 'attention:human', strength)` | Graded interest that *should* fade if the operator changes their mind — exactly what decay is for. NOT a fact, so not a tuple. |
| Highlight in a **doc/markdown pane** | `feedback.drop({surface:'doc:<path>:<L1-L2>'})` + `['doc:annotation', ...]` with **quoted text** as a redundant anchor (Marker.io lesson) | Survives small line drift. |
| "Apply this to all front-end agents" | `channels` publish on `harbor:<h>:role:frontend` + `agent_inbox` to each active matching agent | Channel for the standing group, inbox for guaranteed delivery. |
| **Operator cursor / which-pane-am-in** (MULTIPLAYER presence) | **nothing persistent** — live websocket on `presence:<harbor>:<surface>`, no DB row | Figma/Miro lesson: presence is not a fact; persisting it DDoSes your own tuple table. |
| Human "I'm editing this file" | the existing `session_files` claim with `claimed_by:'human:erich'` | Humans claim files *exactly like agents* so the swarm respects them. Reuse, don't invent. |

**Three rules to graft into the TUI's signal-drop design:**
1. **Redundant anchors beat one brittle anchor** — store `(file, lines)` *and*
   `quoted_text` *and* (for the web preview) selector/bbox. Re-anchoring survives
   reflow; single-anchor annotations rot.
2. **Persistence vs presence are different channels** — durable signal-drops are
   pheromone/tuple/feedback writes; the operator's live cursor in a multiplexed
   pane is ephemeral websocket fanout. Don't conflate (this is also a 60fps win:
   presence never hits SQLite).
3. **`git_sha_at_annotation`** on every human signal — lets an agent reading the
   note 3h later diff "what the human was looking at" vs HEAD (GitHub PR
   staleness, made native). High-leverage, nearly free.

---

## Source 3 — `cli/commands/attention.ts` (the "operator editor" / attention aggregator)

**`cli/commands/attention.ts`** · branch `origin/feat/pheromone-viz-design-v2`.

**The idea.** `pd attention` is a **single-call aggregator** of an agent's inbox
+ subscribed channels: one call returns everything other agents queued for you
and marks it seen. Subcommands: default fetch-and-mark-read, `--peek` (fetch
without marking), `--json` (stable machine schema), `--limit N`,
`--subscribe/--unsubscribe/--subscriptions`. Identity resolves
`--agent` > `$PD_AGENT_ID` > `.portdaddy/current.json`, and **errors loudly** if
no identity resolves (no silent empty fetch). Backed by daemon routes
`/attention`, `/attention/subscribe`, `/attention/unsubscribe`,
`/attention/subscriptions`.

**Which TUI feature.** This is the read-side engine for the **HiTL top bar** and
the **MULTIPLAYER** "what are my agents saying" panels. The vision's "HiTL
surface I can never miss" + "view of what my agents are doing" is `pd attention
--json` rendered as a live panel. The stable JSON schema (`AttentionItem`:
`source, id, agentId, from, channel, type, content, contentType, receivedAt`) is
*ready-made* for a TUI list widget.

**Built vs research.** **BUILT** — this is real, shipped CLI code on PR #231 with
a stable JSON contract and a daemon route behind it. Not a mock. (Note: the file
is the *read/aggregate* half of "operator editor"; it does not itself contain a
signal-*drop* subcommand — the drop side is the Source-2 modality map, still
research. Don't assume `pd attention` writes; it reads.)

**Concrete primitives to reuse.**
- `GET /attention?agentId=&peek=&limit=` → the TUI's HiTL feed. Use `--peek` for
  the always-visible panel (don't mark-read just because it's on screen);
  mark-read only on explicit operator action.
- The `AttentionItem` schema is the TUI list-row model — adopt it directly so the
  operator-avatar and the TUI render the same shape.
- The **identity-resolution chain** (`--agent` > env > `.portdaddy/current.json`)
  is the pattern the TUI process should follow to know "who am I" when it opens.

---

## Source 4 — Pheromone Vocabulary v1 (the kind catalog + decay model)

**`docs/design/pheromone-vocabulary-v1.md`** · branch
`origin/design/pheromone-vocabulary-v1` ("pd-substrate-publish" work). Status:
**v1, accepted** (design doc; implementation downstream).

**The idea.** Locks an **18-kind catalog** across four families — *topological*
(`hot:editing`, `cold:abandoned`, `flow:hot-path`, `recent:touched`), *economic*
(`attention:human-blocked`, `cost:burning`, `budget:nearing-cap`,
`urgency:overdue`), *reputational* (`experience:succeeded/failed/reverted`,
`quality:test-failing/test-flaky`, `freshness:stale-doc`,
`dependency:upstream-changed`), *coordination* (`claim:contested`,
`salvage:pending`, `group:overlap-detected`). Each kind has a meaning, spray-site,
reader, target-type, init-strength, **per-kind half-life**, an idle-decay flag,
clear-events, and a composition role. The **typing rule**: pheromones encode
*graded attention that decays*, never facts — facts go to tuples/feedback/episodic
memory.

**Which TUI feature.** This is the **legend and color/glyph language** for the
entire **HEAT-FILETREE** + **ROLLED-UP HEAT-TREE**, and it defines what the
**HiTL** surface must escalate.

**Built vs research.** **Research-only / accepted design.** Cites the live decay
path (`lib/pheromone.ts:18,65,113,139` — single global `decayRate` today) that
this doc unblocks into per-kind half-life. No per-kind decay shipped yet.

**Concrete primitives to reuse (these are the TUI's rendering contract — adopt
wholesale, do not re-invent):**
- **The urgency primacy axis** drives heat color:
  `urgency = max(1.00·human-blocked, 0.95·test-failing, 0.85·cost:burning)`.
  Color goes hot *only* when intervention is right — a *trouble* gauge, not a
  *busyness* gauge. This is the single most important rule for the HiTL "never
  miss it" requirement: the screen stays calm when the fleet is just working.
- **The always-visible reserved set**: `attention:human-blocked` (🛑 / cobalt),
  `quality:test-failing` (⚠ / ochre), `cost:burning` ($ / cinnabar) get
  guaranteed glyph slots regardless of dominance. *(Glyph caveat for this repo:
  the vocabulary doc proposes emoji glyphs, but the TUI's hard constraint #2 is
  **no emojis as UI icons** — maritime/neobrutalist glyph vocabulary only. So
  reuse the* kind catalog *and the* reserved-set semantics*, but re-map glyphs to
  the mockups' Braille/flag/octant vocabulary. Flag this when grafting.)*
- **Activity-gated decay** (`decay_during_idle` per kind): session-scoped kinds
  (`hot:editing`, `cost:burning`, `claim:contested`) pause decay when the fleet
  is idle; code-scoped kinds (`experience:*`, `quality:*`) keep decaying on
  wall-time. *Directly serves the vision's "alive" filetree* — when the operator
  walks the dog and comes back, the tree doesn't lie and show "all cold." This is
  the half-life-models-fleet-time-not-wall-time insight.
- **Per-kind half-lives** (e.g. `hot:editing`=300s, `recent:touched`=900s,
  `experience:reverted`=7d) are the animation/decay timing constants the TUI's
  "feel" pass needs — the heat fade rate is *defined here*, don't guess it.
- **The spray-hook table** (§5) names the exact `file:symbol` where each kind gets
  sprayed (`lib/sessions.ts` claim-refresh → `hot:editing`, `lib/sugar.ts` done →
  `experience:*`, etc.). When the TUI later wants live heat, this is the wiring map.

---

## Source 5 — Pheromone Lifecycle + Hierarchical Heat-Trees

**`docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`** · branch
`origin/design/pheromone-vocabulary-v1`. Status: design doc (targets v3.9.0
lifecycle / v3.9.1 viz).

### 5a. Pheromones as mutable commons (lifecycle: spray / revoke / rename / fork + lineage)

**The idea.** Ant-colony pheromones are accumulate-only — you can't "unsay" a
trail. Software agents need the opposite: **revoke** (a false-positive
`security_risk`), **rename** (`flakiness` → `test_instability` globally),
**fork** (two teams disagree on what `heat` means → split the dimension), and
**lineage** (who sprayed this, why, when — git-like history). Proposes a
`pheromones` table augmented with `status/redirect_to/origin_id` plus an immutable
append-only `pheromone_events` ledger; CLI verbs `pd pheromone
revoke|rename|fork|lineage`; and **expiry contracts** (`--expires-when
'{"condition":"pr_merged","target":"PR#4142"}'`) beyond plain geometric decay.

**Which TUI feature.** **SIGNAL-DROP** (the operator can *revoke* or *re-aim* a
signal they dropped, not just add) and the **HiTL** audit trail (hover a tile →
"who sprayed this, why, is it stale?"). The lineage ledger is what makes operator
signals *accountable* and *undoable* — closing the loop the vision opens when it
says "drop my own pheromones to instruct."

**Built vs research.** **Research-only**, future-versioned (v3.9.x). Builds on the
real `(entity_table, entity_id, key, strength, last_decay_at)` schema.

**Concrete primitives to reuse.**
- The **`pheromone_events` append-only ledger** shape — if the TUI ever shows a
  tile's history (Mode C time-axis with provenance), this is the source table.
  Also note it converges with the operator's stated "triage taxonomy in PD DB"
  vision (stable UUIDs, audit trail) from MEMORY.
- **Expiry contracts** map cleanly onto operator signal-drop UX: "watch this file
  until PR #X merges, then clear my note automatically" — a TUI signal-drop dialog
  field, not just a TTL slider.

### 5b. Hierarchical correlation-clustered heat-trees + per-layer normalization

**The idea.** Flat heat maps don't scale (50 files = fine, 5000 = useless). Borrow
from computational biology: **(A) clustered dendrogram heatmap** — rows are
files/dirs, columns are pheromone dimensions, both axes clustered by correlation
so co-occurring kinds sit adjacent and files with shared profiles cluster even if
not physically adjacent; **(B) per-layer normalization** — re-scale contrast
*within the visible subtree at each zoom level* so drilling into a quiet
`src/auth/` still shows full contrast (dynamic-range compression, locally
adaptive). Proposes `GET /pheromone/heat-tree?root=&depth=&dimensions=&cluster=`
returning row/column dendrograms + a normalized matrix + the aggregation rule
used.

**Which TUI feature.** This is the **ROLLED-UP HEAT-TREE** done *right* — directly
the vision's "rolled-up tree visualizations … zoom from repo → dir → file → line,
heat aggregating up the tree." Per-layer normalization is the answer to "how do I
not show a grey blob when I zoom into a quiet directory."

**Built vs research.** **Research-only**, v3.9.1 target. The flat predecessor
(`GET /pheromone/files`) is live.

**Concrete primitives to reuse.**
- **Per-layer normalization** is the single highest-value idea for the TUI's
  rolled-up tree — without it, zoom is a contrast-loss event. Implement in the
  daemon (`/pheromone/heat-tree` returns `per_dimension_max` for the layer) so
  every surface (TUI, web, FleetBar) re-normalizes identically.
- **Aggregation rule is editorial and must be in the legend.** The lifecycle doc
  argues `p95_child` / size-weighted-mean; the viz-research doc argues `max`
  headline + per-kind rollup. *These two docs disagree* — see punch list. Pick one,
  write it in the legend, don't let a collapsed-node color lie about what it means.
- The **`/pheromone/heat-tree` query-param shape** (`root`, `depth`, `dimensions`,
  `cluster`) is the TUI navigation contract: arrow-key drill-in = re-request with a
  deeper `root`.

---

## What to graft into VISION / ADR-0046 — punch list

A tight, concrete list for whoever writes `docs/adr/0046-tui-fleetbar.md` (it does
not exist yet — it's deliverable #1 in [`AGENT-HANDOFF.md`](./AGENT-HANDOFF.md)).

1. **Adopt the 5 viz modes as the TUI's filetree feature spec.** Mode A = rolled-up
   heat-tree, Mode B = line/word/symbol leaf, Mode C = "alive"/time, Mode D = HiTL
   glance, Mode E = how the operator-avatar reads it. Cite
   `pheromone-visualization-research.md`. *(Source 1)*

2. **Lock the urgency primacy axis as the heat-color law.**
   `max(1.0·human-blocked, 0.95·test-failing, 0.85·cost:burning)` drives hue;
   everything else is glyph-only. This makes "colorful but legible / never miss
   HiTL" a *rule*, not a vibe. Cite `pheromone-vocabulary-v1.md` §4.1. *(Source 4)*

3. **Re-map the 18-kind glyph set onto the maritime/neobrutalist vocabulary.** The
   vocabulary doc's emoji glyphs violate TUI constraint #2 (no emojis as icons).
   Keep the *kinds, reserved-set, and color families*; swap glyphs to Braille/flag/
   octant. Add this as an explicit ADR-0046 task. *(Source 4 × AGENT-HANDOFF
   constraint)*

4. **Build SIGNAL-DROP on the modality→primitive map — reuse, don't invent.**
   region-note = `feedback.drop` + `file:annotation` tuple; "look here" =
   `pheromones.spray('files', path, 'attention:human')`; presence = ephemeral
   websocket, never SQLite; human file-edit = `session_files` claim as
   `human:erich`. Cite `multiplayer-input-research.md` §2. *(Source 2)*

5. **Three signal-drop invariants → ADR acceptance criteria:** redundant anchors,
   persistence-vs-presence split, `git_sha_at_annotation` on every human signal.
   *(Source 2)*

6. **HiTL + "my agents" panels read `pd attention --peek --json`.** It's *built*
   (PR #231) with a stable schema — the TUI's first honest, non-Potemkin live
   panel. Adopt `AttentionItem` as the row model. Cite `cli/commands/attention.ts`.
   *(Source 3)*

7. **Per-layer normalization is non-negotiable for the rolled-up tree.** Put
   `GET /pheromone/heat-tree` (with `per_dimension_max` per layer) on the ADR's
   daemon-dependency list; arrow-key drill = re-request with deeper `root`. Cite
   `PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md` §2. *(Source 5)*

8. **Resolve the aggregation-rule conflict in the legend.** viz-research says `max`
   headline; lifecycle says `p95_child`. ADR-0046 must pick one and the TUI legend
   must state it — a collapsed-dir color that lies is worse than no color. *(Source
   1 vs Source 5)*

9. **Activity-gated decay makes the filetree "alive" honestly.** Session-scoped
   kinds pause decay when the fleet is idle so the tree doesn't go cold while the
   operator walks the dog. Borrow the per-kind half-lives as the TUI's heat-fade
   timing constants for the feel pass. Cite `pheromone-vocabulary-v1.md` §3.
   *(Source 4)*

10. **Signal-drop gets a lifecycle (revoke / re-aim / expiry-contract), backed by
    `pheromone_events`.** The operator must be able to *unsay* and *auto-expire* a
    dropped signal, with a hover-to-see-lineage audit trail on every tile. This
    also feeds the operator's "triage taxonomy in PD DB" vision. Cite
    `PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md` §1. *(Source 5)*

### Already-BUILT primitives worth reusing (the honest-not-Potemkin shortlist)

- `cli/commands/attention.ts` + `GET /attention` — **shipped on PR #231.** HiTL /
  my-agents feed. Stable JSON. Use `--peek` for always-on panels.
- `GET /pheromone/files` + `POST /pheromone/spray` (`routes/pheromone.ts`) — **live
  today.** First real heat panel + the spray write behind operator "look here."
- `cli/commands/pheromone.ts:154-178` — **live** ASCII heat-bar + conflict glyph;
  the rendering idiom to extend, not replace.
- `feedback.drop()` (`lib/feedback.ts`, `source:'human'` field exists),
  `tuples.out()` (`lib/tuples.ts`), `pheromones.spray()` (`lib/pheromone.ts`),
  `session_files` claims, `coordination-route-guard.ts`/`coordination-acl.ts` —
  **all live**; the signal-drop surface is wiring, not new primitives.

### Still research-only (don't promise these as built in ADR-0046)

Per-kind half-life decay, the `pheromone_events` lineage ledger, lifecycle verbs
(`revoke`/`rename`/`fork`/`lineage`), expiry contracts, the three new viz
endpoints (`/pheromone/tree`, `/pheromone/history`, `/pheromone/sniff`), the
`/pheromone/heat-tree` clustered+normalized endpoint, AST/symbol-level overlay
(blocked on `lib/symbol-index.ts` being wired into `server.ts`).
