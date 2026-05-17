# 0031. Spider — The Surface-Finder

## Status

Proposed — 2026-05-16

## Context

Port Daddy's internal roadmap lives in four Cartographer-maintained markdown files (`NEXT-CUTS.md`, `IDEAS-TROVE.md`, `DOGFOOD-FEEDBACK.md`, `CURRENT-WORK.md`). Cartographer is the single writer; everyone else reads via `lib/roadmap-progress.ts`. This is intentional — the single-writer invariant prevents the same idea from being recorded in three different shapes by three different actors.

The cost of that invariant: **promotion is slow and patterns get missed.** New ideas surface in session notes, transcript outcomes, dogfood feedback, and external signals (dep changelogs, my own blog drafts, competitor releases) faster than Cartographer manually notices them. The operator (Erich) has explicitly said: "I want every session's full chat and thinking log to also be streamed or recorded to port-daddy so I can see those as though I'm in claude code now." That's a Spider-shaped problem: read the streams continuously, *spot the pattern*, draft an entry, hand the draft to Cartographer for commit.

This ADR specifies **Spider** as a Shipwright archetype + supporting infrastructure. Spider does not write to the roadmap directly; it **drafts** entries into a `cartographer_drafts/` queue that Cartographer absorbs (or rejects with a note). The single-writer invariant is preserved.

Spider is the generative half of a Spider/unSpider pair (see ADR-0032). Spider expands; unSpider contracts. Together they keep the map growing without bloating.

The roadmap surface itself is currently file-based. A future ADR-0033 will migrate it to a SQLite-backed schema. Spider is designed to be transparent to that migration — its draft format is data, not markdown.

## Decision Drivers

- The talent-phonebook (ADR-0030) gave us routing-with-evidence; Spider gives us **idea-surfacing-with-evidence** as the upstream feeder for the same routing.
- `lib/roadmap-progress.ts` already structures Cartographer's 4 files into typed objects — Spider can read the same projection without re-parsing.
- `lib/activity.ts`, `lib/session-notes.ts`, `lib/transcript-store.ts` (PR-A #29), and `lib/feedback.ts` already record everything Spider needs to read.
- `lib/spawner.ts` can run Spider as a recurring sortie via `pd spawn --backend ollama --recipe spider` once the recipe lands.
- Operator pain: ideas drown in 4 files. Spider promotes the buried.
- Constraint: Spider must not hallucinate patterns from thin evidence. Minimum evidence threshold is non-negotiable.

## Architecture Decision

Add Spider as an archetype in `lib/shipwright/archetypes.ts`. Build `lib/cartographer-drafts.ts` as the draft staging surface. Wire Spider into `pd fleet up` (scheduled) and `pd spider` (on-demand). Outputs are typed `SpiderDraft` records on disk (`~/.port-daddy/cartographer-drafts/<draft-id>.json`) **and** as rows in a future `cartographer_drafts` table — same schema, two storage backends behind a single read/write API.

Spider runs on the cheap-classifier tier for pattern detection (Cloudflare llama-3.2-1b at ~$0.001/call) and escalates to mid-tier (Haiku) only for prose draft generation. Daily cost target: ≤$0.30/day under normal load.

---

## 1. Archetype Definition

Add to `lib/shipwright/archetypes.ts`:

```typescript
export const SPIDER: AgentArchetype = {
  id: 'spider',
  name: 'Spider',
  family: 'generative',
  pairs_with: 'unspider',
  description: 'Surfaces patterns from session activity into draft roadmap entries.',
  voice: {
    register: 'warm-speculative',
    examples: [
      "Three sessions this week touched lib/router.ts — promote talent-phonebook from IDEAS to NEXT?",
      "Two transcripts mentioned ratatui v0.30 quadrant markers. Worth a NEXT-CUT for the TUI upgrade?",
    ],
  },
  reads: [
    'activity:*',
    'session_notes:*',
    'transcript_store:*',
    'feedback:status=backlog',
    'feedback:status=parked',
    'roadmap-progress:*',
    'changelog:external',
  ],
  writes: ['cartographer_drafts:*'],
  forbidden_writes: ['NEXT-CUTS.md', 'IDEAS-TROVE.md', 'DOGFOOD-FEEDBACK.md', 'CURRENT-WORK.md'],
  triggers: ['cron:nightly', 'event:sortie.completed:n=5', 'manual:pd spider'],
  budget_usd_per_day: 0.30,
  backend_default: 'cloudflare:@cf/meta/llama-3-8b-instruct',
  backend_escalation: 'claude:haiku-4.5',
};
```

---

## 2. Draft Schema

```typescript
export type DraftKind = 'next-cut' | 'idea' | 'website-roadmap';
export type DraftStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface SpiderDraft {
  id: string;                       // crypto-random
  kind: DraftKind;
  slug: string;                     // suggested slug; Cartographer may rename
  title: string;
  summary: string;                  // 1–3 sentences in Cartographer-style
  evidence: SpiderEvidence[];       // MINIMUM 3 — enforced at creation
  confidence: number;               // 0–1; Spider's self-rating
  suggestedPriority: 'now' | 'next' | 'soon' | 'someday';
  suggestedOwner: string | null;    // null = no recommendation
  blastRadius: 'lib' | 'route' | 'cli' | 'mcp' | 'docs' | 'cross-cutting';
  cost_to_date_usd: number;         // accounting trail
  status: DraftStatus;
  createdAt: number;
  expiresAt: number;                // default: created + 7 days
  cartographerNote: string | null;  // populated on accept/reject
}

export interface SpiderEvidence {
  source: 'activity' | 'session-notes' | 'transcript' | 'feedback' | 'roadmap' | 'external';
  ref: string;                      // event id, note id, transcript id, etc.
  excerpt: string;                  // ≤200 chars
  timestamp: number;
}
```

**Three-evidence minimum.** Spider must cite at least 3 evidence rows per draft, each from at least 2 distinct `source` types (so a draft can't be built from 3 session-notes — must triangulate across surfaces). Enforced in `createDraft()`.

---

## 3. Module Shape

**New files:**

- `lib/cartographer-drafts.ts` — `createDraftStore(db, opts)` factory. Methods: `create()`, `list({kind, status})`, `accept(id, note)`, `reject(id, note)`, `expire()`. Self-initializes `cartographer_drafts` table. Falls back to file-backed `~/.port-daddy/cartographer-drafts/*.json` when SQLite path is unset.
- `lib/spider.ts` — `createSpider(deps)` factory. Methods: `scan({since, kinds})` returns drafts ready for commit, `dryRun({since})` returns drafts without persisting. Calls LLM via `resolveLLMBackend({actor: 'spider'})`.
- `cli/commands/spider.ts` — `pd spider [--dry-run] [--since 24h] [--kind next-cut|idea]`.
- `routes/spider.ts` — Fastify plugin. `POST /spider/scan` (run), `GET /spider/drafts` (list).
- `mcp/server.ts` — adds `pd_spider_scan` MCP tool.
- `tests/unit/cartographer-drafts.test.ts` — CRUD + expiry.
- `tests/unit/spider.test.ts` — pattern detection on synthetic activity streams.

**Modified:**

- `lib/shipwright/archetypes.ts` — add `SPIDER`.
- `lib/db.ts` — add `cartographer_drafts` DDL to `CORE_SCHEMA_SQL`.
- `routes/index.ts` — register `spiderPlugin`.
- `cli/commands/index.ts` — export `./spider.js`.
- `features.manifest.json` — `spider` feature entry.
- `fleet/spider.sh` — sortie recipe.
- `pd-fleet.yml` (when the YAML engine ships per ADR-0019) — `spider:` entry with cron.

---

## 4. Pattern-Detection Heuristics

Spider's LLM prompt asks for promotion candidates. The candidate-extraction step is structural and pre-LLM:

1. **File-coupling cluster.** Group sessions by `session_files.path` — paths edited in ≥3 distinct sessions in the trailing 14d are candidates for a "this file is becoming a hotspot — needs a cut" draft.
2. **Repeated-phrase candidate.** Run BM25 over session-notes content for the trailing 14d. Top-K phrases that appear in ≥3 sessions become candidates. Pre-filter against existing NEXT CUTS slugs to skip already-tracked.
3. **Feedback graduation.** Any `feedback` row with `status='parked'` for ≥14 days OR `status='backlog'` for ≥30 days is a candidate for graduation (promote-or-drop).
4. **External signals** (when opted in via `~/.port-daddy/spider-sources.yaml`):
   - Watched GitHub repo new releases (e.g., ratatui, syntect, sqlite)
   - Watched RSS / changelog URLs
   - Internal blog/whitepaper commits to website-v2 that introduce new concepts

For each candidate, Spider sends the structural evidence to the cheap classifier with the prompt:

```
You are Spider, a roadmap-pattern surfacer for Port Daddy.

Candidate: <pattern signature>
Evidence (3+ rows): <evidence array>
Existing NEXT CUTS (titles only): <list>
Existing IDEAS-TROVE (titles only): <list>

For this candidate, output JSON:
  - promote: true | false
  - reason: ≤20 words why
  - confidence: 0–1
If promote=true, also output:
  - kind: 'next-cut' | 'idea'
  - slug: kebab-case, ≤6 words
  - title: ≤8 words
  - summary: 1–3 sentences in Cartographer-style (terse, evidence-bound)
  - suggestedPriority: 'now' | 'next' | 'soon' | 'someday'
  - blastRadius: 'lib' | 'route' | 'cli' | 'mcp' | 'docs' | 'cross-cutting'

Output ONLY JSON. No prose.
```

Confidence threshold for promotion-to-draft: 0.6. Below that, candidate is discarded but logged at debug level for audit.

---

## 5. Public API

### CLI: `pd spider [flags]`

```
pd spider                          # scan + persist drafts since last run
pd spider --dry-run                # scan + print, don't persist
pd spider --since 7d               # override default 24h window
pd spider --kind next-cut          # restrict to one kind
pd spider --json                   # machine-readable
pd spider --list                   # list pending drafts
pd spider --accept <draft-id> -m "Cartographer note"   # delegate to cartographer
pd spider --reject <draft-id> -m "Rejected because ..."
```

Exit codes: `0` = at least one draft produced/listed, `1` = no candidates above threshold, `2` = invocation error.

### Route: `POST /spider/scan`, `GET /spider/drafts`, `POST /spider/drafts/:id/{accept,reject}`

### MCP: `pd_spider_scan`

Category `'routing'` (alongside `pd_route_question`). Standard tier.

---

## 6. Schema Migration

```sql
CREATE TABLE IF NOT EXISTS cartographer_drafts (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence_json   TEXT NOT NULL,
  confidence      REAL NOT NULL,
  suggested_priority TEXT NOT NULL,
  suggested_owner TEXT,
  blast_radius    TEXT NOT NULL,
  cost_to_date_usd REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  cartographer_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON cartographer_drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_kind ON cartographer_drafts(kind);
CREATE INDEX IF NOT EXISTS idx_drafts_expires ON cartographer_drafts(expires_at);
```

This table is **also** the natural staging ground for ADR-0033 (Roadmap as Database). When that migration ships, `cartographer_drafts` joins `roadmap_entries` directly — no schema change to Spider.

---

## 7. Trigger Model

- **Scheduled**: cron `0 4 * * *` (4am local, before the operator wakes) — full 24h scan + draft.
- **Event-driven**: after every 5th `sortie.completed` event, run incremental scan since last run.
- **On-demand**: `pd spider` with optional `--since`.
- **Daily budget cap**: `PD_SPIDER_BUDGET_USD=0.30` (overridable). Spider aborts mid-run if cap reached, logs warning.

---

## 8. Test Surface

### `tests/unit/spider.test.ts`

1. File-coupling cluster detection: seed 4 sessions on `lib/router.ts` in 14d → exactly one cluster surfaces as candidate.
2. Three-evidence minimum enforced: candidate with 2 evidence rows is rejected by `createDraft()`.
3. Source-diversity enforced: candidate with 3 evidence rows but all `source='session-notes'` rejected.
4. Confidence threshold: synthetic candidates with confidence 0.5 / 0.6 / 0.7 → only ≥0.6 produces drafts.
5. Feedback-graduation candidate: feedback row with `status='parked'` and `created_at < now - 14d` surfaces.
6. Daily budget cap: mock backend returns cost 0.10 per call; after 3 calls, scan aborts.
7. Dry-run mode: no drafts persisted, returned in memory.
8. Pre-filter against existing slugs: candidate matching existing NEXT-CUT slug is dropped silently.

### `tests/integration/spider.test.ts`

1. End-to-end: ephemeral daemon, seed sessions+notes+feedback, run `POST /spider/scan`, assert drafts persist.
2. Cartographer absorption path: accept a draft via `POST /spider/drafts/:id/accept` → assert the cartographer-write-hook fires (mocked).

---

## 9. Manifest + Parity

```json
"spider": {
  "description": "Surface roadmap patterns from session activity",
  "cli": ["spider"],
  "sdk": ["spiderScan", "spiderList", "spiderAccept", "spiderReject"],
  "routes": ["POST /spider/scan", "GET /spider/drafts", "POST /spider/drafts/:id/accept", "POST /spider/drafts/:id/reject"],
  "mcp": ["pd_spider_scan"],
  "completions": ["spider"],
  "docs": { "readme": true, "sdk": true, "adr": "0031" }
}
```

---

## 10. Build Sequence

- [ ] **Phase 1 — Archetype + schema.** Add `SPIDER` to archetypes. Add `cartographer_drafts` DDL. Tests for `createDraftStore()` CRUD.
- [ ] **Phase 2 — Spider scan core.** `lib/spider.ts` with structural candidate extraction + LLM prompt. Tests 1–7.
- [ ] **Phase 3 — Route + CLI + MCP.** `routes/spider.ts`, `cli/commands/spider.ts`, MCP tool. Manifest entry. Integration tests.
- [ ] **Phase 4 — Cartographer absorption hook.** When draft is accepted, write to Cartographer's surface (file today, table after ADR-0033). Closed loop.
- [ ] **Phase 5 — Fleet scheduling.** Add to `fleet/spider.sh`. Wire to `pd fleet up`. Cron config.

---

## 11. Risks + Mitigations

**Risk: Spider hallucinates patterns from thin evidence.**
Mitigation: three-evidence + two-source-type minimum, enforced at creation. Pre-LLM structural extraction does most of the work; LLM only writes prose.

**Risk: Spider produces too many drafts → operator drowns.**
Mitigation: confidence ≥0.6, hard daily budget cap, optional `--limit N` on scan. Drafts auto-expire after 7d if not accepted/rejected.

**Risk: Cartographer commit lag means same idea drafts repeatedly.**
Mitigation: scan pre-filters candidates against existing slugs (case-insensitive) in NEXT CUTS, IDEAS-TROVE, and pending drafts.

**Risk: Spider drifts in voice from Cartographer.**
Mitigation: prompt requires "Cartographer-style: terse, evidence-bound." Spider's voice doesn't ship to user-facing surfaces — operator only sees drafts via `pd spider --list` or vibe.

**Risk: External-signal opt-ins (deps, RSS) leak network calls without operator consent.**
Mitigation: external sources OFF by default. Opt-in via `~/.port-daddy/spider-sources.yaml`. Spider logs every external fetch via `pd activity`.

**Risk: Roadmap migrates to DB (ADR-0033) and Spider's file-write path breaks.**
Mitigation: `cartographer-drafts.ts` exposes a single API; backend swap (file → SQLite) is invisible to Spider.

---

## Consequences

### Positive
- Buried ideas in 4 files surface daily into a single draft queue.
- Cartographer's single-writer invariant is preserved.
- The operator's voice memory directive ("ideas land in 4 files no one opens at once") is operationally answered.
- Spider's draft schema is the natural staging ground for ADR-0033's roadmap DB.
- Pairs with unSpider (ADR-0032) for a generative/critical loop on the same surfaces.

### Negative
- New LLM cost lane: ≤$0.30/day, capped. Audit-trail per draft.
- `cartographer_drafts` table adds a new write surface to the daemon DB.
- External signal opt-ins introduce network calls — must be operator-gated.

---

## PR Title

`feat(spider): surface-finder agent — drafts roadmap entries for Cartographer review`

## PR Description

- Adds the Spider archetype to `lib/shipwright/archetypes.ts` and a structured draft staging surface in `lib/cartographer-drafts.ts` (+ `cartographer_drafts` table).
- `pd spider [--dry-run] [--since 24h]` runs pattern detection across `activity`, `session_notes`, `transcript_store`, `feedback`, and (opt-in) external signals; emits typed `SpiderDraft` records with ≥3 evidence rows from ≥2 source types.
- Cheap-classifier tier (Cloudflare llama-3.2-1b) for pattern triage; mid-tier (Haiku) for prose draft generation. Daily budget cap `$0.30`.
- Drafts auto-expire after 7d; Cartographer accepts/rejects via `pd spider --accept/--reject`.
- Full CLI/SDK/route/MCP parity; `pd_spider_scan` lands in the `routing` MCP category.
- Pairs with unSpider (ADR-0032) for generative/critical roadmap maintenance.

---

## Follow-up

**ADR-0033 (proposed):** Migrate Cartographer's 4 markdown files to a SQLite `roadmap_entries` schema, with the existing files becoming a generated export. Spider's draft schema joins directly; unSpider's contradiction queries become real SQL instead of file-grep. Unlocks real-time SSE on `roadmap.*` events.
