# 0038. Claim Tree — Multi-Granularity Coordination Over Hierarchical State

## Status

Proposed (2026-05-19)

## Context

Port Daddy's file-claim model (`session_files` table, ADR-0028) is flat:
each row is a session × file pair, optionally with a line range and a
symbol. The audit of 2026-05-19 found that of 1,637 claims in production,
**zero** used `start_line`, `end_line`, or `symbol` — every claim was
whole-file. The schema was ready; the data wasn't there.

Even if every claim used line ranges and symbols, the flat model can't
answer the questions the coordination model actually needs:

> *"Anything claimed under `lib/auth/`?"*
> *"Does this commit touch any symbol another session has claimed?"*
> *"Show me the active claim tree for this repo."*

These are inherently *hierarchical* queries against an inherently
hierarchical claim space — directories nest, files contain regions,
regions contain symbols, symbols import other symbols. Flat scans don't
compose. The pattern is well-known in database systems where it's called
**multi-granularity locking** (Gray, 1976): locks can be held at row,
page, or table level, with intention modes signaling that descendants are
locked so ancestors block conflicting operations cheaply.

ADR-0037 (git access control + pd feature verbs) introduces the
**soft-claim broadcast** model: file-level claim overlaps inject context
warnings into the con flicting agent's next turn rather than refusing the
write. That model has a placeholder for **overlap risk scoring** (LOW /
MEDIUM / HIGH) which is currently file-level only — until claim-tree data
exists, the daemon can't distinguish "we both edit `auth.ts` but different
functions" from "we both edit the same `signToken` function."

The same hierarchical spine — directories containing files containing
regions containing symbols — is what every tree-shaped repo visualization
shares: pheromone heat trees, AST overlays, git churn maps, cost-by-file,
audit-overlap views, test-coverage maps. Today each of those is a
bespoke renderer. With a shared claim-tree data type, they become
composable overlays on one spine.

This ADR defines the **claim tree**: the hierarchical data structure for
multi-granularity claims, the API for reading/writing it, the visualization
layers that consume it, and the implementation phasing.

## Decision

A claim tree is a hierarchical structure whose nodes represent claimable
units at increasing specificity, and whose edges carry **bubble-up and
push-down** semantics so claims at one granularity inform queries at every
other.

### Data structure

```
ClaimTreeNode {
  id:           string              // stable: e.g. 'repo:port-daddy/lib/auth.ts:120-180'
  kind:         NodeKind            // see below
  path:         string              // 'lib/auth.ts' for a file
  parent_id:    string | null
  start_line?:  number              // present for region/symbol
  end_line?:    number
  symbol?:      string              // present for symbol nodes
  symbol_path?: string              // e.g. 'AuthService.signToken'
  claims:       ClaimRecord[]       // active + historical
}

NodeKind = 'repo' | 'directory' | 'file' | 'region' | 'symbol' | 'symbol-region'

ClaimRecord {
  session_id:  string
  agent_id:    string
  identity:    string               // e.g. 'port-daddy:cartographer'
  mode:        ClaimMode            // see below
  scope:       'this' | 'descendants' | 'subtree'
  claimed_at:  number
  released_at: number | null
  intent:      string | null        // free-form scope hint
}

ClaimMode = 'exclusive' | 'shared' | 'intention-shared' | 'intention-exclusive'
```

Modes mirror MGL (Gray 1976):

| Mode | Meaning | Compatible with |
|---|---|---|
| `S` (shared) | "I read this, others may read" | S, IS |
| `X` (exclusive) | "I'm writing this, nobody else" | (nothing) |
| `IS` (intention-shared) | "I have S on a descendant" | IS, IX, S |
| `IX` (intention-exclusive) | "I have X on a descendant" | IS, IX |
| `SIX` | "S on this + IX on descendants" | IS |

For PD's use case, the typical claim pattern is **`IX` on the directory →
`IX` on the file → `X` on the symbol**. That gives ancestor queries the
information "something is claimed under here" without locking everything.

### Bubble-up / push-down semantics

- **Push-down query**: "What's claimed under `lib/auth/`?" walks the
  subtree, collecting active claims at any descendant node. O(depth × claims)
  with an index on `parent_id`.
- **Bubble-up query**: "Is this symbol claimed anywhere?" walks from
  symbol → file → directory → repo, returning the most specific match.
  O(depth) per node.
- **Overlap query**: "Would my X on `signToken` conflict with anyone?"
  bubbles up to find IX or X on ancestors; walks down to find S, X, or
  descendant claims that overlap line range.

### Identity and stability — anchor to AST, not lines

Line numbers are the wrong frame of reference. A claim on `lib/auth.ts:120-180`
breaks when someone adds an import above (everything shifts). The canonical
node identity is **AST-anchored**, with line-number regions kept only as a
degraded fallback when the AST isn't available.

Node ID hierarchy:

- `repo:<name>` for the root
- `dir:<path>` for directories — path-stable; renaming a dir migrates
  active claims to the new id via the file-move event from the shim
- `file:<path>` for files — same
- `symbol:<path>:<symbol_path>` for functions / classes / methods — the
  PRIMARY claim unit; identity derived from tree-sitter symbol-index events
  (`AuthService.signToken`, not lines). Survives reformatting, comment
  changes, and line shifts; expires only on rename or removal (tracked).
- `block:<path>:<anchor>` for AST blocks that aren't named symbols — e.g.
  the body of a switch case, an arrow-function expression, a top-level
  `{}` block. Anchor is derived from the smallest enclosing AST node plus
  a stable AST path (`auth.ts > FunctionDeclaration[signToken] > BlockStatement > SwitchStatement > SwitchCase[2]`).
- `fenced:<path>:<begin-marker>` for comment-fenced regions — explicit
  operator markers like `// PD-CLAIM-BEGIN auth-validation` / `// PD-CLAIM-END`.
  Stable as long as the markers stay; survives any reformatting between
  them. The fence syntax is language-agnostic (any line comment plus the
  `PD-CLAIM-BEGIN`/`END` tokens).
- `region:<path>:<start>-<end>` — **fallback only**, used when neither
  symbol-index nor fenced markers are available (e.g., languages without
  tree-sitter support, parse errors, plain-text files). Soft-expires when
  the file's content hash changes.

#### Why same-frame-of-reference matters

Every comparison the daemon makes — "do these two claims overlap?",
"does this commit touch a claimed symbol?", "is this `pd diff` against the
claimed scope?" — must use the SAME anchoring scheme on both sides. Mixing
line-range claims with AST-resolved diffs is the failure mode where the
daemon says "no overlap" because the line numbers technically don't match
while the agents are literally touching the same function. **The rule:
when both sides have an AST resolution, compare at AST; when one side
doesn't, downgrade BOTH sides to line-range comparison and emit a
LOW-confidence flag in the overlap result.**

Node-id stability is the hard problem. The compromise:
- `repo` / `dir` / `file` — fully stable (path-keyed)
- `symbol` — high stability (rename detected, formatting absorbed)
- `block` — high stability when AST path is short and unique; degrades
  for deeply-nested blocks where insertion shifts AST node indices
- `fenced` — operator-visible stability (the markers are explicit)
- `region` — low stability; expected to soft-expire frequently

### Storage

A single table extending what `session_files` already does:

```sql
CREATE TABLE claim_tree_nodes (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  parent_id     TEXT REFERENCES claim_tree_nodes(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  start_line    INTEGER,
  end_line      INTEGER,
  symbol        TEXT,
  symbol_path   TEXT,
  content_hash  TEXT,                -- for region-stability checks
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX idx_ctn_parent ON claim_tree_nodes(parent_id);
CREATE INDEX idx_ctn_path ON claim_tree_nodes(path);
CREATE INDEX idx_ctn_symbol ON claim_tree_nodes(path, symbol_path);

CREATE TABLE claim_tree_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id       TEXT NOT NULL REFERENCES claim_tree_nodes(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,        -- S / X / IS / IX / SIX
  scope         TEXT NOT NULL,        -- this / descendants / subtree
  intent        TEXT,
  claimed_at    INTEGER NOT NULL,
  released_at   INTEGER
);
CREATE INDEX idx_ctc_session ON claim_tree_claims(session_id, released_at);
CREATE INDEX idx_ctc_node_active ON claim_tree_claims(node_id) WHERE released_at IS NULL;
```

`session_files` is preserved for backwards-compat; new code reads from
`claim_tree_claims` via `claim_tree_nodes`. A migration backfills nodes
from the existing `session_files` rows.

### API

```typescript
interface ClaimTreeStore {
  // Discovery
  resolve(spec: ClaimSpec): ClaimTreeNode;     // 'lib/auth.ts:120-180' -> node
  ensureNode(spec: ClaimSpec): ClaimTreeNode;  // create if missing
  
  // Claim ops
  claim(node: ClaimTreeNode, session: string, mode: ClaimMode, opts: ClaimOpts): ClaimRecord;
  release(claim_id: number, reason?: string): void;
  
  // Query
  activeClaimsAt(node: ClaimTreeNode): ClaimRecord[];
  claimsUnder(node: ClaimTreeNode): ClaimRecord[];      // descendants
  conflictsFor(node: ClaimTreeNode, mode: ClaimMode): ClaimRecord[];
  overlapRisk(node: ClaimTreeNode, session: string): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  
  // Subscription
  subscribe(predicate: (event: ClaimEvent) => boolean): Subscription;
}
```

Overlap risk computation (consumed by ADR-0037 soft-claim broadcast):

```
HIGH    = literal line-range overlap on the same file
        OR symbol equivalence (same symbol_path)
        OR ancestor X on subtree

MEDIUM  = shared symbol import (transitive)
        OR sibling claims under same SIX ancestor

LOW     = different files, OR different symbols in same file,
        OR non-overlapping line ranges, OR IS on shared ancestor only

NONE    = no overlap detected
```

### Provenance: where node data comes from

- **Directories and files**: from the working tree (`fs.readdirSync` +
  `path.dirname`). Auto-discovered on first claim or as a periodic walk.
- **Regions**: from the diff at claim time. `pd add lib/auth.ts` against a
  region range from the staged diff registers a region node.
- **Symbols**: from `lib/symbol-index.ts` (currently unwired — see
  `ast-claim-wiring` slug). The tree consumes symbol-index events to
  populate symbol nodes; symbol-rename / removal events update or expire
  them.
- **Symbol-regions** (chunks inside symbols): generated on demand when an
  agent claims a sub-range of a function.

Until symbol-index is wired, the tree degrades gracefully to
repo/dir/file/region only. The soft-claim risk scoring then can't tell
"same function" from "same file"; it conservatively flags HIGH on shared
files.

### Visualization: shared spine, composable overlays

The deep insight from the design discussion that produced this ADR: the
claim tree is the spine for *every* tree-shaped repo visualization. Each
viz mode is a data adapter mapping the spine's nodes to a render
primitive.

```
[claim_tree_nodes spine]
  └── composable overlays (toggleable, layerable):
        ├── Mode A: pheromone heat        — graded attention per kind
        ├── Mode B: claim ownership       — discrete sessions per node
        ├── Mode C: AST symbol structure  — function/class nesting
        ├── Mode D: git churn             — commit intensity over a window
        ├── Mode E: test coverage         — boolean × intensity
        ├── Mode F: lint / type errors    — error count per node
        ├── Mode G: cost-by-file          — wallet draw via claim history
        └── Mode H: audit-overlap         — Cartographer inconsistencies
```

Renderers:

| Renderer | Modes supported | Default layout |
|---|---|---|
| **CLI ASCII tree** (`pd claims tree`, `pd sniff <path>`) | A, B, F (text-friendly) | ASCII art with glyphs + ANSI color |
| **Web console** (`fleet-config-ui`) | A, B, C, D, E, F, G, H | Annotated file tree sidebar + treemap toggle |
| **FleetBar tile** | B + top-N from D or G | Glance card showing 3 hottest contested nodes |
| **TUI** (future Rust, `core/pd-tui`) | A, B, C, F | ratatui interactive tree |

#### Multi-overlay composition rules

When two layers are active simultaneously, the rules from the
pheromone-viz research apply:

- **Color** drives ONE primary dimension at a time. Operator toggles the
  primary; secondary layers carry glyphs, borders, badges.
- **Glyph / badge** in the corner of a node carries secondary signal — a
  pheromone-heat-colored node can still show a "2 sessions claimed" chip.
- **Border / outline** carries a tertiary signal — red outline for
  conflict regardless of fill.
- **Toggle**, never blend. Don't try to encode pheromone-heat AND
  claim-conflict-severity as fill simultaneously; the result is mud
  (CodeScene and Datadog convergence from the pheromone-viz research).

#### Mode A — ASCII tree (CLI default)

```
pd claims tree lib/auth.ts

lib/                                       [2 sessions, 8 claims, IX]
├── auth.ts                                [2 sessions, MEDIUM overlap]
│   ├─◆ signToken          [session-12abc gardener]   X, 45s
│   └─◆ refreshToken       [session-56def you]        X, NOW
│   └─▪ lines 200-260      [session-56def you]        X, NOW
├── tuples.ts                              [session-12abc gardener]    IX
└── ...

Glyphs: ●file ▪region ◆symbol ◆▾symbol-region    Colors: green=S amber=IX red=X
```

#### Mode B — Annotated file tree (web console)

Standard tree component; each row shows:
- file/dir name
- claim-count chip (right-aligned, color by conflict severity)
- one-line summary on hover: "2 sessions: gardener (signToken), you (refreshToken)"
- click → side panel with diff links, DM buttons, subscribe button

#### Mode B-treemap — Whole-repo treemap

Squarified treemap; rectangle = file, area ∝ LOC, color = ownership
(distinct hue per active session; gray = unclaimed); border thickness =
conflict severity. Useful for "where is the swarm concentrating?"

#### Mode G — Cost-by-file overlay (composed with claim tree)

Wallet draws attributed to claims by elapsed time × cost rate. Color =
USD spent per file in window. Combine with Mode B (ownership) to see
which sessions are burning where.

## Consequences

### Wins

- The soft-claim broadcast model from ADR-0037 gets honest risk scoring.
  Today the broker can only say "same file"; with claim tree it can
  distinguish "same symbol" (HIGH) from "different functions" (LOW).
- Multi-granularity queries become single SQL joins instead of bespoke
  scans. "Is anything claimed under `lib/`?" is one indexed query.
- One tree spine, many overlays — replaces what would otherwise be 7+
  separate viz components with one renderer parameterized by adapter.
- Symbol-level coordination becomes possible without changing the agent's
  mental model. They still call `pd add <path>`; the tree decides whether
  the touch was at file, region, or symbol granularity.
- A unified abstraction also unifies the audit story. Every claim event
  is a row in `claim_tree_claims`; retrospectives query the tree, not 4
  separate tables.

### Tradeoffs

- More schema, more code, more places things can go wrong. Mitigated by
  the `session_files` backwards-compat preservation — if the tree code
  breaks, existing file-level claims still work.
- Node-id stability for regions and symbols is the hard problem. Best-effort
  approaches (content hash invalidation, symbol-rename events from
  tree-sitter) cover the common cases; pathological refactor sequences
  (rename + move + restructure in one commit) will lose region claims.
  The soft-claim model degrades gracefully: lost claim → no warning, but
  no incorrect block either.
- Storage growth: every node ever claimed persists. `pd prune` should
  garbage-collect nodes with no active claims and no descendant claims
  after N days (default 30); kept indefinitely if claims have closed
  cleanly so retrospectives stay queryable.
- Symbol-level data depends on `ast-claim-wiring` (currently unwired).
  Until that ships, the tree is repo/dir/file/region only.

### Migration

**Phase 1 — Schema + read path (1 week):**
- Land `claim_tree_nodes` and `claim_tree_claims` schemas with backfill
  from `session_files`
- Implement `ClaimTreeStore` factory in `lib/claim-tree.ts`
- New routes: `GET /claims/tree?root=<path>`, `GET /claims/overlap?...`
- Ship `pd claims tree` CLI verb (Mode A renderer)
- Backwards-compat: `pd session files add` keeps writing both stores

**Phase 2 — Write path + soft-claim integration (2 weeks):**
- `pd add` writes to `claim_tree_claims` directly with IX inferred at
  ancestors automatically
- `pd add lib/auth.ts:120-180` registers a region node
- ADR-0037's soft-claim broadcast consumes `overlapRisk(...)` for risk
  scoring
- Web console Mode B annotated file tree

**Phase 3 — Symbol granularity (3 weeks, blocked on ast-claim-wiring):**
- Tree-sitter symbol-index emits events; claim-tree subscribes and
  populates symbol nodes
- `pd add lib/auth.ts:signToken` resolves to symbol node directly
- Mode B treemap overlay; Mode F lint overlay
- HIGH risk scoring activated for symbol equivalence

**Phase 4 — Composable overlay framework (1 month):**
- Web component refactor: extract the file-tree spine into a shared
  React component
- Adapter interface: `{ getValue(node) => { color, glyph, badge, border } }`
- Mode A pheromone heat + Mode B claim ownership + Mode D git churn live
  side by side, operator toggles primary axis
- FleetBar tile B + G

### Resolved during draft review (2026-05-19, operator pass 2)

- **Region anchoring:** line numbers are the wrong primitive; AST symbols,
  AST blocks, and comment-fenced regions are the right ones. Same frame
  of reference required for both sides of any overlap comparison. See
  "Identity and stability — anchor to AST, not lines" above.
- **Lock escalation:** auto-escalate to a parent `IX` when ≥5 sibling
  claims active under the same parent. The auto-escalated claim has
  `intent: "auto-escalated from 5+ sibling claims"` for audit
  transparency.
- **GC + dynamic pruning + owner notifications:** claims are advisory
  (no hard lock; ADR-0037 enforces worktree-level lock separately). GC
  default 30 days, but contested claims accelerate. The claim owner
  receives top-of-context messages whenever another session attempts to
  touch their claimed asset — gentle nudge to release if done. See
  "Claims as advisory + dynamic pruning + owner nudges" subsection below.
- **Auto-subscribe owners + subtree subscriptions:** claim owners are
  automatically subscribed to all activity on their claimed assets (file
  / region / symbol / block / fenced). Subscriptions support subtree
  fan-in via `scope: 'subtree'`. See "Auto-subscribe semantics" below.
- **CRDT semantics planned now, not deferred:** the storage schema is
  reshaped around an op log so the tree state is a fold over operations.
  Movable-tree CRDT (Kleppmann 2021) semantics for tree-shaped ops;
  Lamport-clock-ordered op log. See "CRDT-ready storage" subsection.
- **Per-repo trees:** confirmed; `repo:` root distinguishes. Cross-repo
  claims are handled via independent claims in each tree.

### Claims as advisory + dynamic pruning + owner nudges

Claims are advisory by design. Hard enforcement lives in two adjacent
places only:
- **ADR-0037 per-worktree session lock** — one session-of-record per
  worktree at a time (the unit of "I am editing here right now")
- **ADR-0037 hard-refuse verbs** — destructive git verbs, force-push to
  protected branches, true single-resource locks

Inside a worktree the claim tree is informational. Overlapping claims
don't block; they broadcast (ADR-0037 soft-claim model). The value of a
claim is its advertisement function: declaring intent, surfacing the
risk score, giving the ambient context broker something to project.

#### Owner top-of-context notifications

Whenever a session other than the claim owner attempts to touch a
claimed asset (file write, region edit, symbol modification, `pd add`),
the daemon emits a `claim:approach` event. The claim owner gets this in
their next-turn ambient context:

```
[PD context — your claim is being approached]

session-Y-56def78 (qa) is about to edit symbol AuthService.signToken
which you have claimed since 4h ago for "Refactor token signing".

Their declared scope: "Add tests for token expiry" (touches your symbol
via test imports, not direct edit).

Overlap risk for them: LOW

If you're done with this claim, run:
  pd release claim-<id>                        — release
  pd release claim-<id> --note "msg"           — release with handoff note

If you still need it, no action needed; they'll proceed with the soft
warning. To DM them:
  pd inbox send session-Y-56def78 "I'll be done in ~15 min"
```

The nudge is gentle. The point is to give the holder a chance to release
the claim when they're actually done, instead of leaving zombie claims
that the GC must reap.

#### Contest-driven dynamic pruning

The GC half-life on a claim is not static at 30 days. It accelerates
when the claim is contested:

```
effective_idle_threshold = base_threshold * exp(-k * contest_pressure)

base_threshold       = 30 days
contest_pressure     = count(claim:approach events on this claim in last 24h)
k                    = 0.3 (tunable)

contest=0  → 30d
contest=1  → 22d
contest=3  → 12d
contest=5  → 7d
contest=10 → 1.5d
```

A claim that nobody else cares about persists for the full 30 days. A
claim that 10 other sessions are trying to work around in a day gets
pruned in ~36 hours. This makes the GC adaptive: low-traffic claims
behave as advisory long-term markers; contested claims behave as
short-term reservations that decay if the owner doesn't actively use
them.

#### Rate-limiting `claim:approach` to prevent prune-storm DoS

A naive implementation lets a single agent polling once per second
saturate contest_pressure to 86,400 in a day, dropping the effective
idle threshold to near-zero and pruning any claim in milliseconds. That
turns the soft-claim broadcast into a DoS primitive.

Two rate limits prevent this:

- **Per-(session, target) cooldown** — only one `claim:approach` event
  per (originating session, target node) pair is counted per `claim:approach.cooldown_seconds` (default **300 s**). A polling agent saturates at one event per five minutes per target it's actually trying to touch.
- **Global pressure cap** — `contest_pressure` is min(N_distinct_sessions, 24h-event-count). A single repeated offender can never push pressure past `N_distinct_sessions`. Three distinct sessions trying to touch the claim caps pressure at 3 even if they collectively emit 600 events.

The first cap is the one that matters in practice: it makes
`claim:approach` a coarse-grained signal of "is someone else
genuinely interested in this work right now," not a hot loop.
Audit-trail: every cooldown-suppressed event still gets a row in
`activity_log` for retrospectives.

When the GC reaps a contested claim, the owner gets a final
`claim:expired-under-contest` event with the prune timing and the
sessions that contested. They can re-claim immediately if they're still
active; the re-claim resets contest pressure to 0.

### Auto-subscribe semantics

When session X claims node N, X is automatically subscribed to events on
N with `scope: 'subtree'`. The subscription is bound to the claim
record, not to X explicitly — releasing the claim releases the
subscription. Events delivered:

| Event | Trigger | Default delivery |
|---|---|---|
| `claim:approach` | Another session about to touch N | top-of-context next turn |
| `claim:overlap-detected` | The shim's overlap check fires elsewhere | top-of-context next turn |
| `claim:contested` | claim:approach count crosses threshold | top-of-context next turn |
| `node:edited` | A commit lands touching N | next turn ambient |
| `node:tested` | Test results land referencing N | next turn ambient |
| `node:reverted` | A revert touching N is committed | top-of-context next turn |
| `subtree:claim` | New claim under N's subtree by another session | next turn ambient |

The subscription composes with the ambient-context-broker budget (see
ROADMAP § 8). Owner notifications get priority allocation — they're
explicit reservations, not opt-in streams.

Manual subscriptions via `pd subscribe node:<id> --scope subtree` exist
for sessions that want to follow nodes they don't claim (e.g., a QA
session subscribing to a feature branch's claim subtree).

### CRDT-ready storage

To keep the tree distributable in the future (multiple daemons across
machines, V4 remote-harbor scenarios), store the state as an **op log
plus materialized view**. The op log is the source of truth; the
relational tables in the schema below are a cache materialized by
folding the log in causal order.

```sql
CREATE TABLE claim_tree_ops (
  op_id          TEXT PRIMARY KEY,         -- ULID, lexicographically sorted by time
  lamport_clock  INTEGER NOT NULL,         -- Lamport timestamp for causal ordering
  origin_node    TEXT NOT NULL,            -- daemon node id where op originated
  op_kind        TEXT NOT NULL,            -- 'claim' | 'release' | 'move' | 'rename' | 'split' | 'merge'
  payload        TEXT NOT NULL,            -- JSON: op-kind-specific fields
  created_at     INTEGER NOT NULL,
  applied_at     INTEGER                   -- when materialization caught up
);
CREATE INDEX idx_cto_lamport ON claim_tree_ops(lamport_clock);
CREATE INDEX idx_cto_unapplied ON claim_tree_ops(applied_at) WHERE applied_at IS NULL;
```

Op kinds:

- `claim` — `{ node_spec, session_id, mode, scope, intent }`
- `release` — `{ claim_id, reason? }`
- `move` — `{ from_node_id, to_node_spec }` — file/dir rename, symbol rename
- `rename` — `{ node_id, new_symbol_path }` — symbol-only rename within file
- `split` — `{ parent_node_id, child_specs[] }` — a new symbol appears inside a claimed block
- `merge` — `{ from_node_ids[], target_node_id }` — symbols collapse during refactor

#### Movable-tree CRDT semantics (Kleppmann 2021)

The hard CRDT problem is `move`. When two daemons concurrently move
overlapping subtrees, naïve approaches can produce cycles (A becomes a
child of B AND B becomes a child of A). Kleppmann's algorithm uses a
timestamped log with conflict resolution:

1. Each op has `(lamport_clock, origin_node)` as its unique identifier
2. Ops are applied in lamport order across all daemons
3. A `move` that would create a cycle is **undone on the loser** when a
   conflicting earlier op surfaces
4. The log retains undone ops with `tombstoned: true` for replay
   determinism

For PD's single-daemon-today case, this is overhead — but the storage
shape doesn't change. The lamport clock is set from a monotonic local
counter; conflict resolution is a no-op because no concurrent ops exist.
When PD distributes, the algorithm activates without a schema migration.

#### Materialized view refresh

The relational tables (`claim_tree_nodes`, `claim_tree_claims`) are
rebuilt by replaying ops from the last applied op. Refresh is
incremental in normal operation (apply the latest N ops); periodically
the daemon does a full rebuild for catch-up after long downtime or
schema migration.

`pd claims tree` reads from the materialized view; writes go to the op
log first and then update the view in the same transaction. The view is
always consistent with the log; the log can be replayed standalone for
debugging.

#### Snapshots

To keep the op log bounded, the daemon snapshots the materialized view
periodically (default daily) and prunes ops older than the snapshot.
Snapshots include the full tree state at a lamport clock; restoring
from a snapshot + tail of ops since the snapshot fully reconstructs
state. This is the standard event-sourcing pattern; no novel design
here.

### Documentation

A reader-friendly documentation page at `docs/concepts/claim-tree.md`
explains the tree, the claim modes, the visualizations, and worked
examples with prose and diagrams. The ADR is the *specification*; the
docs page is the *explanation*. See follow-up PR.

### Open questions remaining

(Most originals resolved during draft review; what's left:)

1. **AST block stability under heavy refactor:** if a function is split
   in two during a refactor, does the claim on its body migrate to one
   of the halves or split into two claims? Lean: emit a `split` op,
   create two child claims, notify the owner top-of-context.
2. **Fence marker convention across languages:** propose `// PD-CLAIM-BEGIN <slug>` /
   `// PD-CLAIM-END` for C-family; `# PD-CLAIM-BEGIN` for Python/Ruby/shell;
   `<!-- PD-CLAIM-BEGIN -->` for HTML/XML. Codify or leave as convention?
   Lean: codify in the shim so editors / linters can lint the markers.
3. **Snapshot frequency / op log size:** daily snapshots probably fine
   for single-daemon; when distributed, snapshots should align with
   network sync windows. Defer to the distribution ADR.
4. **Materialized view vs query-the-log:** for small repos the log is
   tiny and you could skip the materialized view. Lean: always
   materialize; the view is the read path everywhere.

### Related work and prior art

- **Gray (1976), "Granularity of Locks and Degrees of Consistency"** — the
  foundational MGL paper. Defines IS/IX/SIX modes and the lock compatibility
  matrix used here.
- **Kleppmann (2021), "A highly-available move operation for replicated
  trees"** — modern reference for tree CRDT semantics. Future direction
  if PD distributes.
- **CodeScene, CodeCharta, Sourcegraph** — production tools that visualize
  code health on a hierarchical spine; the multi-overlay model here is
  inspired by their separability conclusions (one dimension drives color,
  others carry glyphs).
- **PD existing ingredients:** `lib/trie.ts` (radix trie, basis for fast
  hierarchical lookup), `lib/merkle-tree.ts` (Anchor Protocol evidence —
  similar shape, different purpose), `lib/symbol-index.ts` (unwired but
  has the symbol extraction primitives), `session_files` table (current
  flat claim store, to be migrated).

### Related ADRs and slugs

- **ADR-0037** — Git access control + pd feature verbs. Forward-references
  this ADR for soft-claim overlap risk scoring.
- **ADR-0028** — Actor / Fleet / Agent / Session three layers. Provides
  the identity model claims attach to.
- **ADR-0033** — Roadmap Pop atomic claim. The roadmap claim is a
  specialized one-level instance of the same pattern.
- **ROADMAP § 8** — Substrate Activation. Specifically:
  - `ast-claim-wiring` — symbol-level granularity dependency (Phase 3 here)
  - `heat-tree-viz` — Mode A renderer dependency
  - `ambient-context-broker` — consumer of overlap risk scoring
  - `pheromone-vocabulary-v1` — Mode A pheromone overlay dependency
