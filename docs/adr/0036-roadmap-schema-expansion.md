# 0036. Roadmap Items Schema Expansion — Jira-forward, Team-ready

## Status

Accepted

## Context

`roadmap_items` (`lib/roadmap-items.ts`, introduced PR #94) carries a
narrow per-item shape — slug, summary blob, status enum,
single-promoter provenance, flat dependencies list. That was right for
slice A; it is **not** right as the destination for the markdown
migration the operator asked for ("dump its contents into SQL and
delete it") nor for the team-product trajectory the operator named
("think forward for selling this, teams will need it").

Four markdown surfaces (`docs/ROADMAP.md`,
`docs/recovery/IDEAS-TROVE.md`, `docs/recovery/DOGFOOD-FEEDBACK.md`,
`docs/recovery/CURRENT-WORK.md`) carry 14 distinct structural facts the
current schema cannot absorb. A schema gap analysis
(`~/coding/tmp/roadmap-schema-gap-analysis.md`, see PR description)
inventories them. This ADR is the destination-schema decision; PR-β
will land the migration script + read-path rewires + file deletions
on top of this foundation.

## Decision

The roadmap-items domain grows from one entity to **one entity + four
related tables + one events table**, with breathing room baked in for
multi-tenant deployment. All schema work lands in PR-α; nothing reads
or writes the new shapes yet beyond unit tests.

### 1. Extend `RoadmapItem`

```ts
interface RoadmapItem {
  // === existing (unchanged) ===
  id: string;                    // UUID, preserved across upserts
  slug: string;                  // identity key
  status: RoadmapStatus;         // see §1.1 (default set) + arbitrary string
  promotedFromFeedbackId: string | null;
  promotedByAgentId: string | null;
  promotedAt: number | null;
  lastTouchedAt: number;
  harbor: string;                // see §1.5 (hierarchy doc'd, not enforced)

  // === content split — replaces summaryMd blob ===
  title: string;                 // human-readable display name
  whyMd: string | null;          // "why it matters" prose
  nextCutMd: string | null;      // "next cut" / what-to-do-next prose
  descriptionMd: string | null;  // long-form, optional

  // === hierarchy (option α from gap analysis) ===
  parentId: string | null;       // points at another item; nulls = top level
  ordering: number;              // sort within parent; defaults to 0

  // === team-forward breathing room (nullable today) ===
  teamId: string | null;
  workspaceId: string | null;
  workflowId: string | null;     // future per-workspace status workflow

  // === lifecycle / visibility ===
  visibility: 'private' | 'team' | 'org' | 'public';   // default 'fleet'-equivalent
                                                       // = 'team' in team mode,
                                                       //   'private' in solo mode
  scheduledAt: number | null;
  startedAt:   number | null;
  dueAt:       number | null;
  completedAt: number | null;
}
```

#### 1.1 Status — default set plus open string

The default 6 values: `now | merge | backlog | parked | done | quarantined`.

`quarantined` is the 6th (operator-confirmed): for research / reset
threads that the operator explicitly rejects but doesn't want deleted.
Today's CURRENT-WORK.md "Quarantined Reset Research" maps cleanly onto
it.

The `status` column accepts **any string**, not just the default set.
Teams pay for the right to define their own workflows
(`draft → in-review → approved → shipped`). A future `workflowId`
column points at a per-workspace `workflows` table; until then, the
default 6 are the canonical set and CLI tools validate against them.
Arbitrary strings round-trip through the tuple stream unchanged.

#### 1.2 Content split — why we splice the blob

`summaryMd` collapsed three distinct fields the markdown carried
separately: "why it matters", "next cut", and a leading title. Splitting
them is cheap migration (regex-parse the markdown), gives the CLI three
queryable surfaces, and matches the natural reader flow ("what is this,
why does it matter, what's the next step").

Backward compat: `summaryMd` stays as a computed alias for the trio,
returned by the read path so existing callers don't break:
```
summaryMd = title + '\n\n' + whyMd + '\n\n' + nextCutMd
```

#### 1.3 Hierarchy — alpha (containers are items)

Operator chose alpha. A "## section" in ROADMAP.md, an "Active Side
Thread" narrative in CURRENT-WORK.md, and an actionable "next cut"
slug all live in the same table. The container is an item whose
children point at it via `parentId`. Depth is unbounded.

`ordering` is per-parent. Items with the same `parentId` sort by
`ordering` ascending, then `lastTouchedAt` descending for ties.

#### 1.4 Visibility — 4-valued for team-forward

`private | team | org | public`. In solo mode (no `teamId`), only
`private` and `public` are meaningful; `team` and `org` are no-ops the
solo client treats as `private`. The schema accommodates the team
case today so no migration is needed when teams arrive.

#### 1.5 Harbor — current shape stays, future shape doc'd

Current `harbor` = `<project>:fleet` (flat string). Future shape:
`<org>:<team>:<project>:<fleet>`. We do not migrate the namespace in
this PR. Constraint: nothing in PR-α makes a decision that prevents
that future migration (e.g., we do not parse `harbor` as anything
other than an opaque string).

### 2. Four relational tables

```sql
-- typed edges between items
CREATE TABLE IF NOT EXISTS roadmap_item_edges (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL,          -- blocks | depends-on | extends |
                                  -- supersedes | duplicates | related-to |
                                  -- split-from | splits-to
  by      TEXT,                   -- agent_id of who created the edge
  at      INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_edges_to ON roadmap_item_edges(to_id);

-- N principals with roles (replaces the single promotedByAgentId slot
-- for "current owner" / "contributor" / "reviewer" semantics; the
-- promoter stays on the item for source provenance)
CREATE TABLE IF NOT EXISTS roadmap_item_owners (
  item_id        TEXT NOT NULL,
  principal_id   TEXT NOT NULL,
  principal_type TEXT NOT NULL,    -- agent | user | team
  role           TEXT NOT NULL,    -- owner | contributor | reviewer | worker
  at             INTEGER NOT NULL,
  PRIMARY KEY (item_id, principal_id, role)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_owners_principal
  ON roadmap_item_owners(principal_id, role);

-- typed pointers to external artifacts (the universal join surface)
CREATE TABLE IF NOT EXISTS roadmap_item_artifacts (
  item_id TEXT NOT NULL,
  kind    TEXT NOT NULL,           -- see §2.1 for the kind glossary
  ref     TEXT NOT NULL,           -- URL, SHA, file path, quote text, etc.
  label   TEXT,                    -- optional human label
  at      INTEGER NOT NULL,
  PRIMARY KEY (item_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_artifacts_kind_ref
  ON roadmap_item_artifacts(kind, ref);

-- flat tags (phase membership, ad-hoc labels, GTM categorization)
CREATE TABLE IF NOT EXISTS roadmap_item_tags (
  item_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_tags_tag ON roadmap_item_tags(tag);
```

#### 2.1 Artifact `kind` glossary

The kind column accepts arbitrary strings; documented set:
- `pr` (ref = PR URL or `owner/repo#NN`)
- `commit` (ref = SHA, label = subject)
- `adr` (ref = `ADR-NNNN` slug)
- `doc` (ref = repo-relative path, e.g., `docs/recovery/CURRENT-WORK.md`)
- `url` (ref = absolute URL)
- `session` (ref = PD session id)
- `note` (ref = PD note id)
- `spark-feedback` (ref = `.spark/feedback/<filename>`)
- `spider-connection` (ref = `.spider/connections/<filename>`)
- `operator-quote` (ref = the quote text; label = date + context)
- **team-forward (no schema change needed):** `linear-issue`,
  `jira-ticket`, `github-issue`, `notion-page`, `slack-message`,
  `figma-frame`, etc.

### 3. Events table replaces inline notes

```sql
CREATE TABLE IF NOT EXISTS roadmap_item_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   TEXT NOT NULL,
  kind      TEXT NOT NULL,          -- note | status-change | edge-added |
                                    -- owner-added | tag-added | artifact-added
  by        TEXT,                   -- agent_id / user_id / 'system'
  at        INTEGER NOT NULL,
  payload   TEXT                    -- JSON; shape varies by kind
);
CREATE INDEX IF NOT EXISTS idx_roadmap_events_item ON roadmap_item_events(item_id, at DESC);
```

Inline `notes` on `RoadmapItem` deprecates; the read path materializes
notes from `roadmap_item_events WHERE kind = 'note'` and returns the
same shape callers expect today. **Compliance + audit for paid teams
is non-negotiable;** this is the table that earns the right to charge.

### 4. Tuple stream evolves alongside (not instead)

Existing tuples (`roadmap:upserted`, `roadmap:status`, `roadmap:touched`)
remain as the **write log + cross-process notification channel**. The
new tables are **read indexes computed from the tuples** plus the
relational concepts the tuples don't model (edges, owners, artifacts,
tags, events).

Cartographer continues to be the only writer of the items domain.
Subscribers continue to see `roadmap:upserted` etc. and can react. The
SQL tables are projections + relations that callers query for the
shapes tuples can't express in a single read.

## Rationale

Three designs were considered:

1. **One big table** — pack every field into `roadmap_items` (one row
   per item, JSON columns for edges/owners/artifacts/tags). Rejected:
   the cross-table JOIN gives us indexed lookups Linear/Jira-style
   ("show me every item @alice owns") that JSON columns can't.
2. **Replace `roadmap_items` entirely with a new `work_items` model.**
   Rejected: the existing tuple stream is the audit trail; throwing it
   away to rename the entity costs the move-fast invariant Cartographer
   relies on.
3. **Extend `roadmap_items` + add relational tables alongside the
   tuple stream.** *(chosen.)* Backward-compatible. Tuples stay
   authoritative for status + audit. Tables carry the
   relational/cross-cutting shapes. Each addition is a single ALTER
   or CREATE; nothing else moves.

The "team-forward breathing room" choice (nullable `teamId` /
`workspaceId` / `workflowId` + 4-valued visibility) costs ~20 LOC and
buys the future migration. We do not pay for unused columns today
(SQLite ignores NULLs), and the alternative (rewriting the schema when
teams arrive) is a much bigger move.

## Consequences

### Positive

- **Markdown migration becomes mechanical** — every structural fact in
  the four markdown files has a home in the new schema.
- **Indexed cross-cutting queries** — "every item @alice owns",
  "every item tagged `phase-3`", "every item with an active PR
  artifact" — all single-table lookups.
- **Compliance-ready audit trail** via `roadmap_item_events`.
- **Team-mode migration is additive**, not rewrite — `teamId` /
  `workspaceId` / `workflowId` columns already exist; team mode
  populates them.
- **The whitepaper / GTM story** ("Port Daddy is the local DB-of-record
  for agentic coordination") gets concrete schema to point at.

### Negative

- **Five new tables + one expanded interface** is real schema surface.
  Backups, migrations, dump/restore tooling all grow.
- **Two writers on the items domain** — Cartographer via tuples (still
  authoritative for status) AND the relational write paths
  (`linkOwner`, `addArtifact`, `addEdge`, `addTag`). The contract:
  relational writes never change `status` — that stays
  tuple-authoritative — but they CAN add/remove relations.
- **Inline `notes` deprecation** is a breaking change for any caller
  that mutates `RoadmapItem.notes` directly. PR-α keeps the read-side
  alias intact; PR-β rewires writers.

### Neutral

- The tuple stream is unchanged.
- The `id` (UUID) remains the durable identity. Slug stays the
  human-readable handle.
- The migration script in PR-β is a one-shot file-walker; no ongoing
  bidirectional sync between markdown and SQL.

## What lands where

- **PR-α (this PR)**: ADR-0036, schema additions in `lib/roadmap-items.ts`
  (extended interface + 5 new tables + events overlay in read path),
  factory updates (new functions: `addEdge`, `addOwner`, `addArtifact`,
  `addTag`, `events`), tests for each new surface. NO migration script.
  NO markdown deletion. NO read-path rewires elsewhere in the codebase.
- **PR-β (next)**: migration script that parses the four markdown
  files into `roadmap_items` + relations, rewires every reader in the
  codebase (`getRoadmapProgress`, cartographer prompt, website docs
  surface, `pd roadmap` CLI), deletes the four files, updates ADRs
  that reference markdown surfaces.

## Cross-ADR composition

- **ADR-0023 (Cartographer as Navigator).** Cartographer remains the
  only writer of `status` (via tuples) and the bulk-writer of items
  (via `upsert`). The relational tables are populated by Cartographer,
  by pop's release flow (already wired in ADR-0035 for status
  transitions), and by future verbs (`pd roadmap link <slug>
  --owner <agent>` etc.).
- **ADR-0033 / 0034 / 0035 (pop atomic claim, claim ↔ session/agent,
  claim ↔ item).** Unchanged in shape. `roadmap_claims.item_id`
  (ADR-0035) joins against `roadmap_items.id`; the new tables (edges,
  owners, artifacts, tags, events) join on the same `id`.
- **ADR-0030 (Talent phonebook).** Becomes implementable on this
  schema: `pd whois <slug>` resolves slug → item.id → owners
  (relational) + active claim (ADR-0035) + recent events.

## Out of scope

- **Workflow definition table.** `workflowId` is a column today,
  pointing at nothing. The workflows table itself is a follow-up.
- **Permissions / ACLs.** `visibility` is the coarse-grained surface.
  Fine-grained ACLs (per-principal read/write) are a team-mode
  follow-up.
- **External-system bidirectional sync.** Linear / Jira / GitHub
  artifacts can be referenced via the `roadmap_item_artifacts` table
  today; live two-way sync (webhook in, mutation out) is its own
  project.
- **Gantt rendering / timeline visualization.** This ADR provides the
  data fields (`scheduledAt` / `startedAt` / `dueAt` / `completedAt`
  + edges). The UI is a separate concern.
- **The migration itself.** PR-β.
