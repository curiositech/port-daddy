# Pheromone Lifecycle + Hierarchical Correlation-Clustered Heat-Trees

**Status:** Design doc — 2026-04-20
**Targets:** v3.9.0 (lifecycle) and v3.9.1 (heat-tree visualization)
**Motivation:** Stigmergic coordination in ant colonies is
*accumulate-only* — an ant cannot "unsay" a pheromone trail. Software
agents working on a shared codebase need the *opposite*: they need to
revoke, refactor, and split their coordination signals as
understanding evolves. Meanwhile, the UI that reads those signals
needs to make hundreds or thousands of pheromone values legible at
multiple zoom levels, which the standard `key = path, value = number`
scatter plot cannot do.

This doc proposes two tightly-coupled changes:

1. **Pheromones as first-class *mutable commons*** with a full
   lifecycle (spray, revoke, rename, fork) and an immutable lineage
   ledger — the same way code has a git history.
2. **Hierarchical correlation-clustered heat-trees** borrowed from
   computational phylogenetics + expression-matrix visualization, with
   per-layer normalization so contrast stays visible at every zoom
   level.

Both are, to the author's best knowledge, novel in the multi-agent
coordination literature.

---

## §1 The pheromone lifecycle problem

PD's current pheromones are `(entity_table, entity_id, key, strength,
last_decay_at)`. You can `spray`; you can `sniff`; decay is read-time
geometric. That's the ant-colony primitive, and it works for
*ephemeral* signals like "this file is hot right now."

It fails for:

- **Revocation.** Agent A sprays `security_risk=0.9` on `src/auth.ts`.
  Later, Agent B audits and the risk is false-positive. Today the only
  remedy is re-spray with `0.0`, but any consumer who already read
  `0.9` has no way to know the authority was revoked vs. the value
  decayed naturally.
- **Renaming.** The swarm has been using `flakiness` for "flaky test"
  pressure. Shipwright decides the cleaner name is
  `test_instability`. Every existing sprayer must be edited.
- **Forking.** Two teams disagree on what `heat` means. One means
  "currently being edited," the other means "recently edited +
  reviewer attention needed." Today they conflict on the same key.
  They should be able to fork the dimension.
- **Lineage.** Was this `security_risk=0.8` sprayed by the guardian
  agent's static analysis, or by a human code review, or by a
  propagation from a child file? Provenance is not queryable today.
- **Expiry contracts.** A sprayer saying "this signal expires when X
  is no longer true" — today the only expiry is geometric decay.

### §1.1 The proposal: pheromones get git-like lineage

New tables:

```sql
-- Existing, augmented.
CREATE TABLE pheromones (
  entity_table TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  key          TEXT NOT NULL,
  strength     REAL NOT NULL,
  last_decay_at INTEGER,
  -- NEW: lifecycle fields
  status       TEXT NOT NULL DEFAULT 'active',  -- active | revoked | renamed | forked
  redirect_to  TEXT,                            -- when renamed, the new key
  origin_id    INTEGER,                         -- FK to pheromone_events(id)
  PRIMARY KEY (entity_table, entity_id, key)
);

-- NEW: full lineage ledger. Immutable append-only.
CREATE TABLE pheromone_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    INTEGER NOT NULL,
  event_type    TEXT NOT NULL,    -- spray | revoke | rename | fork | decay-snapshot
  entity_table  TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  strength      REAL,             -- for spray
  new_key       TEXT,             -- for rename
  fork_parent_id INTEGER,         -- for fork
  author        TEXT,             -- agent ID or identity
  reason        TEXT,             -- free-text provenance hint
  half_life_ms  INTEGER,          -- per-dimension decay rate
  expires_when  TEXT               -- JSON expiry contract (see §1.3)
);

CREATE INDEX idx_ph_events_entity ON pheromone_events(entity_table, entity_id, key, created_at);
```

Every state change is an event. Current state is a view; history is
the source of truth. Salvage-queue-grade durability.

### §1.2 CLI surface (v3.9)

```bash
pd pheromone spray files src/auth.ts heat 0.8 \
  --by agent-spider \
  --reason "3 edits in last hour" \
  --half-life 30m

pd pheromone revoke files src/auth.ts security_risk \
  --by agent-guardian \
  --reason "audit complete; original signal was false-positive"

pd pheromone rename flakiness test_instability \
  --by shipwright \
  --reason "aligning with test ownership vocabulary"
#   ^ global rename; all active pheromones migrate; events logged.

pd pheromone fork heat --to heat_edit heat_review \
  --by shipwright \
  --reason "decouple edit contention from reviewer attention"

pd pheromone lineage files src/auth.ts heat
#   ^ prints the full event history for this signal.
```

### §1.3 Expiry contracts

Instead of only geometric decay, a sprayer can attach a structured
expiry:

```bash
pd pheromone spray files src/auth.ts review_pressure 0.9 \
  --expires-when '{"condition":"pr_merged","target":"PR#4142"}'
```

Contract kinds (closed enum, extensible via daemon plugins):
- `pr_merged` — clears when a referenced PR closes
- `sortie_completed` — clears when sortie finishes
- `tuple_present` — clears when a named tuple lands (e.g. "done")
- `file_modified` — clears if the file is touched by anyone
- `deadline` — absolute timestamp

The daemon evaluates contracts lazily on read (same pattern as
current decay). No extra background loop.

### §1.4 Why this matters beyond hygiene

- **Post-mortems become possible.** "Who sprayed the security_risk
  that turned out to be wrong? What did they know? Did we act on it
  before revocation?"
- **Governance for the Bonded Commons.** A pheromone that turns out
  to be misinformation is bondable — the author can be slashed. But
  only if there's an audit trail of who said what when.
- **Refactorability of the shared signal vocabulary.** You can't
  refactor a vocabulary you can't rename.

---

## §2 The legibility problem — flat heat maps don't scale

PD already has a `GET /pheromone/files` endpoint that returns a flat
list of (path, heat, agents, conflict) tuples. At ~50 hot files that's
fine. At 500 it's a wall. At 5000 it's useless.

Three specific failure modes today:

1. **No hierarchy.** The file tree has structure (`src/auth/login.ts`
   is *inside* `src/auth/`), and most pheromones propagate
   meaningfully up that tree. A folder should be hot if its children
   are.
2. **Multi-dimensional collapse.** Showing `heat` alone is easy; showing
   `heat + flakiness + review_pressure + security_risk` at once in a
   table is impossible to read — eyes pick up the first column and
   ignore the rest.
3. **Per-level contrast loss.** If the whole project has
   `security_risk < 0.1` because it's a quiet day, normalizing
   globally makes everything look grey. A user viewing the `src/auth/`
   subtree cares about relative contrast *within that subtree*.

### §2.1 The proposal: phylogenetic heat-trees

Borrow two techniques from computational biology:

**Technique A: Hierarchical clustering with dendrograms.** The
standard "clustered heatmap" from gene-expression visualization. Rows
are files (or directories); columns are pheromone dimensions. Both
axes get a dendrogram built by hierarchical clustering on correlation
coefficients.

- **Rows:** cluster files that share a pheromone profile. Files under
  `src/auth/` that are all hot+review_pressure cluster together even
  if they're not physically adjacent in the tree.
- **Columns:** cluster pheromone dimensions that correlate. If
  `flakiness` and `review_pressure` co-occur across the codebase,
  they end up adjacent so the eye sees the pattern.

This is *decades-old* in biology (Eisen 1998) but genuinely not
applied to multi-agent coordination data. The payoff is the same:
non-obvious clusters become visible.

**Technique B: Per-layer normalization.** Instead of normalizing
strengths globally, normalize within each visible subtree at each zoom
level.

```
global max = 0.87 (one hot file in all 5k files)

Visible subtree: src/auth/  (47 files)
  subtree max = 0.42
  Re-scale so 0.42 → 1.0 (full saturation) for display

Zoom into src/auth/api/  (12 files)
  subtree max = 0.18
  Re-scale so 0.18 → 1.0 for display
```

Every layer gets full contrast. Drill-in is a re-normalization, not a
loss of visible signal. This is the same trick used in "dynamic range
compression" for photography — locally adaptive, globally consistent.

**Aggregation for collapsed nodes.** A folder's color is a function
of its children. The honest function is *not* `sum`; it's something
closer to "95th-percentile child" or "weighted mean by file size."
Document the choice in the legend so the user knows what they're
reading.

### §2.2 Data shape

New endpoint `GET /pheromone/heat-tree`:

```json
{
  "dendrograms": {
    "rows": { ... hierarchical clustering over file tree + structural similarity ... },
    "columns": { ... hierarchical clustering over pheromone dimensions ... }
  },
  "matrix": [
    // One row per (visible) node, one column per (visible) pheromone dimension
    { "node": "src/auth/",          "dims": {"heat": 0.62, "flakiness": 0.11, ... } },
    { "node": "src/auth/login.ts",  "dims": {"heat": 0.80, "flakiness": 0.00, ... } },
    ...
  ],
  "normalization": {
    "layer": "src/auth",
    "per_dimension_max": { "heat": 0.80, "flakiness": 0.22, ... }
  },
  "aggregation_rule": "p95_child"
}
```

Query params:
- `root` — subtree to render (default: repo root)
- `depth` — how many levels deep to expand
- `dimensions` — which pheromone keys to include
- `cluster` — `rows`, `columns`, `both`, or `none`

### §2.3 The visual

A three-pane layout:

```
              ┌───────────────────────────────────────────┐
              │  column dendrogram (pheromone dimensions) │
              └───────────────────────────────────────────┘
┌──────────┐ ┌───────────────────────────────────────────┐
│   row    │ │                                           │
│dendrogram│ │           the heat matrix                 │
│  (files) │ │   (tiles colored per-dimension, per-layer │
│          │ │    normalized; collapsed nodes are parent │
│          │ │    summaries)                             │
└──────────┘ └───────────────────────────────────────────┘
```

- Click a tile → drill down, re-normalize, show children.
- Click a pheromone dimension header → sort matrix by that dim.
- Click a node → open a sidebar with lineage (§1) for every active
  pheromone on that node.
- Hover → full (unnormalized) values + producers + expiry contract.

### §2.4 Why this is legitimately novel

The three moves together have not, so far as the author can find,
been combined in any multi-agent tool:

- Biologists use clustered heatmaps but not in real time on
  continuously-updating data with per-zoom normalization.
- Code-visualization tools (sunburst maps, codemaps) show *one*
  dimension (usually file size or recency).
- Stigmergic systems (ant algorithms, distributed workflow systems)
  don't expose the pheromone layer to operators at all.

Getting to "your codebase's pheromones at a glance" is the UX
equivalent of the clustered heatmap for gene expression — a tool that
becomes obvious once you've seen it.

---

## §3 Integration with the v3.8.4 consolidated verbs

- `pd say --heat <path>=0.7` already sprays. In 3.9 add
  `--half-life`, `--reason`, `--expires-when` pass-throughs.
- `pd look --heat` today calls `/pheromone/files`. In 3.9 add
  `pd look --heat-tree` that renders (in the terminal for
  accessibility, properly in the UI) the hierarchical view.
- `pd pheromone lineage` is new, the audit-trail read verb.

---

## §4 Implementation order

1. `pheromone_events` table + lineage logging on every spray (no CLI
   change). Backfill from activity log where possible.
2. Revoke + rename verbs (small DB ops, events are the authority).
3. Expiry contracts (pluggable evaluators, lazy on-read).
4. Fork — harder, requires migrating downstream sprayers. Defer.
5. `/pheromone/heat-tree` endpoint — server builds dendrograms with
   a small native clustering implementation (centroid linkage is
   cheap; we don't need full UPGMA). Clustering is per-request; cache
   with a short TTL keyed on the input matrix hash.
6. Heat-tree UI (`fleet-config-ui/src/components/HeatTree.tsx`).
   D3-based matrix rendering + scipy-style dendrograms from
   `hclusterjs` or hand-rolled.

---

## §5 Open questions

- **Cost of clustering on a large matrix.** 5000 files × 6 dimensions
  is fine; 50000 × 20 starts to hurt. Add per-request row/column caps
  and fall back to "top-N most-active" if exceeded.
- **How much history is enough?** The `pheromone_events` table grows
  without bound. Propose: rollup + compact beyond 30 days, preserve
  lineage but drop noise.
- **Fork semantics for existing consumers.** If `heat` forks to
  `heat_edit` / `heat_review`, do old `pd look --heat` calls still
  work? Yes — the post-fork canonical becomes the *union* under the
  old name, with a one-time warning until consumers migrate.
- **Who is authorized to rename a pheromone?** Proposal: the account
  owner of the daemon, or a Shipwright proposal accepted by the
  operator. Never an arbitrary agent.

---

## §6 Citations + prior art

- **Eisen, M.B., Spellman, P.T., Brown, P.O., Botstein, D. (1998).**
  *Cluster analysis and display of genome-wide expression patterns.*
  PNAS 95(25):14863-14868.
- **Ward, J.H. (1963).** *Hierarchical grouping to optimize an objective function.*
  JASA 58(301):301-236. (The linkage criterion most stable under
  outliers — relevant for noisy pheromone matrices.)
- **Theraulaz, G., Bonabeau, E. (1999).** *A brief history of
  stigmergy.* Artificial Life 5(2):97-116. (For the ant→software
  analogy.)
- **Bederson, B.B., Shneiderman, B. (2003).** *The craft of
  information visualization.* — for the locally-adaptive
  normalization pattern.

---

*Last updated 2026-04-20. Companion to
`CONSOLIDATED-VERBS-AND-UI.md` (§3.1 pheromone dimensions beyond
`heat`) and `WHITEPAPER-PATCHES-V2.md` (the whitepaper update adds
pheromone lineage to Bonded Commons §4).*
