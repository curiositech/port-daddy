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

### Identity and stability

Node IDs are *content-keyed* where possible to survive rename/refactor:

- `repo:<name>` for the root
- `dir:<path>` for directories — path-stable; renaming a dir invalidates
  the old id and migrates active claims to the new id via the file-move
  event from the shim
- `file:<path>` for files — same
- `region:<path>:<start>-<end>` for line ranges — *not* stable across
  refactors; soft-expires when the file's content hash changes
- `symbol:<path>:<symbol_path>` for symbols — stable across line shifts
  inside the file, expires when the symbol is renamed or removed (tracked
  via tree-sitter symbol-index events)
- `symbol-region:<path>:<symbol_path>:<offset>-<length>` for in-symbol
  regions — used when an agent claims a chunk inside a large function

Node-id stability is the hard problem. The compromise: stable for
directories/files (paths), best-effort for regions (lines), reasonable
for symbols (renames detected; cosmetic re-indenting absorbed).

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

### Open questions

1. **Region content stability:** when `lib/auth.ts` lines 120-180 shift
   to 130-190 because someone added imports above, does the claim
   migrate? Lean yes via content-hash matching on the claimed slice; soft-expire if no match.
2. **Lock escalation policy:** when an agent holds 80% of files in `lib/`
   as `IX`, should the daemon offer to escalate to a single `IX` on
   `lib/`? Lean yes with a one-line operator prompt; auto-escalate when
   ≥5 sibling claims under the same parent.
3. **GC policy:** prune nodes with no active claims after 30d? Or keep
   forever for audit? Lean: prune nodes from the tree, archive their
   claim records to a sidecar `claim_tree_claims_archive` table for the
   audit story.
4. **Subscription granularity:** should subscribers be able to follow "any
   claim on `lib/auth.ts`" with descendant fan-in? Lean yes; that's the
   point of the tree. Subscribers register on a node id with
   `scope: 'subtree'`.
5. **CRDT consideration:** if PD ever distributes (multiple daemons across
   machines), the tree becomes a candidate for movable-tree CRDT
   semantics (Kleppmann 2021). Out of scope for v1; flagged.
6. **Cross-repo claim trees:** when an agent works across two harbors,
   is there one tree per repo or one global tree? Lean: per-repo (the
   `repo:` root distinguishes); cross-repo claims are an edge case
   handled via independent claims in each tree.

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
