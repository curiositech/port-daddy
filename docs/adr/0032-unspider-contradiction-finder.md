# 0032. unSpider — The Contradiction-Finder

## Status

Proposed — 2026-05-16

## Context

Spider (ADR-0031) keeps surfacing new patterns into Cartographer's draft queue. The map grows. Without a counterweight, growth becomes bloat: two NEXT CUTS contradict each other, three drafts cover the same surface from different angles, doc claims drift from code reality, memory entries reference paths that no longer exist, two Sorties claim overlapping symbols and silently collide at merge.

The operator (Erich) named this role on 2026-05-16: "unSpider — thinking about ways in which roadmap plans or current features break, conflict, overlap or clash. This unspider should add bugs to fix or escalate big things to user with recommendation."

unSpider is the **critical** half of the Spider/unSpider pair. Spider expands the map; unSpider tightens it. Together they keep the map *growing and coherent*. Either alone produces a degenerate map: Spider-only fills with duplicates and conflicts; unSpider-only stagnates.

unSpider has **two output lanes** keyed to severity:
- **Small** (medium severity): file a bug into `dogfood-feedback` with `status='now'`, `source='unspider'`, `suggested=<fix>`. Operator sees it next time they `pd feedback`.
- **Big** (high severity): escalate to `actor:user` inbox with a concrete recommendation. Operator gets notified directly.

Threshold for big vs small is concrete: if the issue blocks a sortie from completing, blocks a PR from merging cleanly, or creates an irreversible state mismatch, it's big. Everything else is small.

unSpider does *not* write to the roadmap. Cartographer remains the single writer. unSpider writes to two surfaces it already owns the contract for: `feedback` (bugs) and `inbox:actor:user` (escalations). The single-writer invariant is preserved.

## Decision Drivers

- Phase 0 audit (the design-system-bootstrap pass) is itself an unSpider output retrospectively: it caught that the prose "tokens compile to 4 surfaces" claim was a lie. unSpider should catch that class of contradiction continuously, not only when an operator does a quarterly audit.
- `lib/feedback.ts` already has `createFeedback({severity, source, suggested})` — the small-output lane is a free composition.
- `lib/inbox.ts` already supports `actor:user` — the big-output lane is also free.
- The roadmap migration (ADR-0033) is "eventually." unSpider must work against the file-based roadmap today, and against the SQLite roadmap tomorrow, without code changes outside `lib/roadmap-progress.ts`.
- Operator constraint: false positives are expensive (annoying noise). Detection requires evidence; recommendations must be actionable.
- Pairs naturally with Spider — same read surfaces, opposite write semantics.

## Architecture Decision

Add unSpider as an archetype in `lib/shipwright/archetypes.ts`. Build `lib/unspider.ts` as a sweep + detection engine. Sweep runs on event triggers (cartographer write, sortie completed, claim acquired) plus a daily catch-all. Each detection produces a `UnspiderFinding` typed record; findings route to small-lane (`feedback`) or big-lane (`inbox:actor:user`) based on severity classification.

Detection runs structurally first (no LLM) for the cheap, high-confidence cases. Ambiguous cases escalate to the cheap-classifier LLM tier for a yes/no contradiction judgment. The big-lane recommendation prose uses mid-tier (Haiku). Daily budget cap: ≤$0.20/day.

---

## 1. Archetype Definition

Add to `lib/shipwright/archetypes.ts`:

```typescript
export const UNSPIDER: AgentArchetype = {
  id: 'unspider',
  name: 'unSpider',
  family: 'critical',
  pairs_with: 'spider',
  description: 'Hunts contradictions, overlaps, and stale references across the roadmap and code reality.',
  voice: {
    register: 'dry-surgical',
    examples: [
      "PR-B (comms+episodic) and PR-C (config+topology) both touch lib/router.ts at the same symbol. Ship B first; C blocks on its routing changes.",
      "Memory feedback_directory_ownership.md references lib/sortie-recipes.ts which doesn't exist; renamed to lib/sorties.ts in PR #29.",
      "Two open Sorties claim lib/auth.ts lines 18–142 and 88–214. Overlap detected on 88–142.",
    ],
  },
  reads: [
    'roadmap-progress:*',
    'sorties:status=running',
    'sorties:status=planned',
    'session_files:active',
    'feedback:*',
    'memory:*',
    'cartographer_drafts:status=pending',
    'code:grep',
    'docs:claims',
  ],
  writes: ['feedback:create', 'inbox:actor:user'],
  forbidden_writes: ['NEXT-CUTS.md', 'IDEAS-TROVE.md', 'DOGFOOD-FEEDBACK.md', 'CURRENT-WORK.md', 'cartographer_drafts:*'],
  triggers: [
    'event:cartographer.write',
    'event:sortie.completed',
    'event:claim.acquired',
    'event:draft.created:spider',
    'cron:daily',
    'manual:pd unspider',
  ],
  budget_usd_per_day: 0.20,
  backend_default: 'cloudflare:@cf/meta/llama-3-8b-instruct',
  backend_escalation: 'claude:haiku-4.5',
};
```

---

## 2. Finding Schema

```typescript
export type FindingKind =
  | 'roadmap-collision'        // two NEXT CUTS touching same surface
  | 'sortie-claim-overlap'     // two active Sorties overlapping file region
  | 'doc-code-drift'           // README/CHANGELOG/skill says X; grep disagrees
  | 'stale-memory-path'        // memory entry references missing file
  | 'duplicate-feedback'       // semantic-near-duplicate of existing feedback
  | 'orphan-cut'               // NEXT CUT with no related code activity in 30d
  | 'budget-exhausted-blocker' // Sortie hit budget cap without producing useful output
  | 'pr-merge-collision';      // two open PRs predict conflict at known symbols

export type FindingSeverity = 'small' | 'big';

export interface UnspiderFinding {
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  confidence: number;                  // 0–1
  surfaces: string[];                  // file paths, slugs, sortie ids, memory paths
  evidence: UnspiderEvidence[];        // minimum 2
  recommendation: string;              // ≤25 words, actionable
  suggestedFix?: string;               // optional code/path snippet
  detectedAt: number;
  resolvedAt: number | null;
  resolution: 'accepted' | 'rejected' | 'auto-resolved' | null;
  outputLane: 'feedback' | 'inbox:user';
  outputRef: string | null;            // feedback id or inbox message id
}

export interface UnspiderEvidence {
  source: 'roadmap' | 'sortie' | 'session-file-claim' | 'memory' | 'code-grep' | 'doc' | 'feedback';
  ref: string;
  excerpt: string;
  timestamp: number;
}
```

**Two-evidence minimum.** Less stringent than Spider's three-evidence rule because contradiction detection is structural and high-precision (a missing file is a missing file). Source-diversity not required — two `code-grep` rows on the same broken claim are valid evidence.

---

## 3. Detection Patterns (structural — no LLM required)

| FindingKind | Detection rule | Cost |
|---|---|---|
| `roadmap-collision` | Two NEXT CUTS reference the same file path in their summary text → flag. Two slugs share a 3-grams overlap >0.6 → flag. | grep + n-gram |
| `sortie-claim-overlap` | Two `sorties.status='running'` whose `session_files` entries intersect on `(path, [start_line, end_line])` ranges. | SQL range query |
| `doc-code-drift` | grep README.md, CHANGELOG.md, `.claude/skills/**/SKILL.md`, `docs/**/*.md` for backtick-quoted symbols (` `lib/foo.ts` ` and `` `functionName(` ``). For each symbol, run reverse grep in the repo. If 0 hits and the doc claim is current (file mtime within 90d), flag. | grep × 2 |
| `stale-memory-path` | Parse memory files under `~/.claude/projects/.../memory/` for paths matching `lib/**`, `routes/**`, etc. Verify each path exists. | fs.existsSync |
| `duplicate-feedback` | New feedback row → BM25 + char-bigram similarity against trailing-90d feedback. ≥0.85 = duplicate candidate. | BM25 + similarity |
| `orphan-cut` | NEXT CUT slug → search session_notes, transcript_store, activity, feedback for slug substring in trailing 30d. 0 hits = orphan candidate. | text search |
| `budget-exhausted-blocker` | `sortie.status='failed'` AND `error LIKE '%budget exceeded%'` AND `result_output IS NULL`. | SQL |
| `pr-merge-collision` | Parse open PRs via `gh pr list --json files`. Two PRs touching the same file with overlapping line ranges = collision. (Requires `gh` CLI; gracefully degrades when absent.) | gh + diff parse |

Each pattern produces structural candidates. LLM is only invoked for **two** purposes:
1. **Yes/no contradiction judgment** for ambiguous cases (e.g., do these two NEXT CUT summaries actually contradict, or are they parallel?). Cheap-classifier tier, ~$0.001/call.
2. **Recommendation prose** for `severity='big'` findings only. Mid-tier (Haiku), ~$0.005/call. Small-lane findings use templated prose, no LLM.

---

## 4. Severity Classification

A finding is `big` if **any** of:
- The contradiction blocks a Sortie from completing (e.g., a sortie's recipe references a missing file).
- The contradiction blocks a PR from merging cleanly (e.g., two PRs predict conflict at a known symbol).
- The drift creates an irreversible state mismatch (e.g., schema migration claims a column that doesn't exist; would break next deploy).
- The operator has explicitly opted the surface in via `~/.port-daddy/unspider-escalate.yaml` (e.g., "always escalate doc-code-drift in `docs/adr/*`").

Everything else is `small`.

Classification runs deterministically. No LLM involved.

---

## 5. Output Lane Routing

### Small lane → feedback

```typescript
await feedback.create({
  status: 'now',
  severity: 'medium',
  source: 'unspider',
  surface: finding.surfaces[0],
  hook: finding.recommendation,
  suggested: finding.suggestedFix ?? null,
  metadata: { finding_id: finding.id, kind: finding.kind, confidence: finding.confidence },
});
```

Operator discovers via `pd feedback --source unspider` or normal feedback review flow.

### Big lane → inbox:user

```typescript
await inbox.send({
  to: 'actor:user',
  from: 'agent:unspider',
  performative: 'INFORM',
  subject: `[unSpider] ${finding.recommendation}`,
  body: renderBigLaneBody(finding),  // formats evidence + recommendation
  metadata: { finding_id: finding.id, kind: finding.kind, severity: 'big' },
});
```

Operator sees in `pd inbox` (or via the future `pd vibe` chat surface — when ADR-0030's pre-send affordance ships, the inbox surface is already routed).

---

## 6. Module Shape

**New files:**

- `lib/unspider.ts` — `createUnspider(deps)` factory. Methods: `sweep({since, kinds})`, `dryRun({since})`, `classify(finding) → 'small' | 'big'`, `route(finding) → outputRef`.
- `lib/unspider-detectors/` — one file per `FindingKind`:
  - `roadmap-collision.ts`
  - `sortie-claim-overlap.ts`
  - `doc-code-drift.ts`
  - `stale-memory-path.ts`
  - `duplicate-feedback.ts`
  - `orphan-cut.ts`
  - `budget-exhausted-blocker.ts`
  - `pr-merge-collision.ts`
- `cli/commands/unspider.ts` — `pd unspider [--dry-run] [--since 24h] [--kind <FindingKind>]`.
- `routes/unspider.ts` — `POST /unspider/sweep`, `GET /unspider/findings`, `POST /unspider/findings/:id/resolve`.
- `mcp/server.ts` — `pd_unspider_sweep` MCP tool.
- `tests/unit/unspider.test.ts` — per-detector unit tests.
- `tests/integration/unspider.test.ts` — end-to-end sweep + escalation.

**Modified:**

- `lib/shipwright/archetypes.ts` — add `UNSPIDER`.
- `lib/db.ts` — add `unspider_findings` DDL.
- `routes/index.ts` — register `unspiderPlugin`.
- `cli/commands/index.ts` — export `./unspider.js`.
- `features.manifest.json` — `unspider` feature entry.
- `fleet/unspider.sh` — recurring sortie recipe.

---

## 7. Public API

### CLI: `pd unspider [flags]`

```
pd unspider                              # sweep + route to feedback/inbox
pd unspider --dry-run                    # sweep + print, no writes
pd unspider --since 12h                  # override default 24h window
pd unspider --kind doc-code-drift        # restrict to one finding type
pd unspider --json                       # machine-readable
pd unspider --list [--severity big]      # list pending findings
pd unspider --resolve <finding-id> -m "Fixed" --status accepted
```

### SDK: `pd.unspider.sweep(opts?)`, `pd.unspider.list(filter?)`, `pd.unspider.resolve(id, opts)`.

### Route: `POST /unspider/sweep`, `GET /unspider/findings`, `POST /unspider/findings/:id/resolve`.

### MCP: `pd_unspider_sweep` — category `'routing'`, standard tier.

---

## 8. Schema Migration

```sql
CREATE TABLE IF NOT EXISTS unspider_findings (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  severity          TEXT NOT NULL,
  confidence        REAL NOT NULL,
  surfaces_json     TEXT NOT NULL,
  evidence_json     TEXT NOT NULL,
  recommendation    TEXT NOT NULL,
  suggested_fix     TEXT,
  detected_at       INTEGER NOT NULL,
  resolved_at       INTEGER,
  resolution        TEXT,
  output_lane       TEXT NOT NULL,
  output_ref        TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON unspider_findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_kind ON unspider_findings(kind);
CREATE INDEX IF NOT EXISTS idx_findings_resolution ON unspider_findings(resolution);
```

---

## 9. Trigger Model

- **Event-driven (primary)**:
  - `event:cartographer.write` → run `roadmap-collision`, `doc-code-drift` against the touched surfaces only (fast, scoped).
  - `event:sortie.completed` → run `budget-exhausted-blocker`, `pr-merge-collision`.
  - `event:claim.acquired` → run `sortie-claim-overlap` against the new claim's region.
  - `event:draft.created:spider` (from ADR-0031) → run `duplicate-feedback` + `roadmap-collision` against the draft before Cartographer reviews it.
- **Daily catch-all**: cron `15 4 * * *` (15 minutes after Spider) — full sweep of `stale-memory-path` + `orphan-cut` + any kind that didn't fire today.
- **On-demand**: `pd unspider`.
- **Daily budget cap**: `PD_UNSPIDER_BUDGET_USD=0.20` (overridable).

---

## 10. Test Surface

### `tests/unit/unspider-detectors.test.ts`

1. `roadmap-collision`: seed two NEXT CUTS with overlapping summary file references → flagged.
2. `sortie-claim-overlap`: seed two running sorties with `session_files` ranges (auth.ts 18-142) and (auth.ts 88-214) → overlap detected on 88-142.
3. `doc-code-drift`: README references `lib/router.ts:findExpert`, but grep finds no `findExpert` in `lib/router.ts` → flagged.
4. `stale-memory-path`: memory references `lib/sortie-recipes.ts` which doesn't exist → flagged.
5. `duplicate-feedback`: new feedback "tokens drift" with 0.92 BM25 similarity to existing "design token unsync" → flagged.
6. `orphan-cut`: NEXT CUT with slug `quantum-sortie-engine` that appears 0 times in 30d activity → flagged.
7. `budget-exhausted-blocker`: sortie with `error='budget exceeded'` AND `result_output=NULL` → flagged.
8. Severity classification: missing file in sortie recipe = `big`; doc drift on a backwater README = `small`.
9. Output lane routing: `big` writes to inbox, `small` writes to feedback. Asserts the right method called.
10. Daily budget cap aborts mid-sweep when reached.

### `tests/integration/unspider.test.ts`

1. End-to-end: ephemeral daemon, seed roadmap + sortie + feedback fixtures, run `POST /unspider/sweep`, assert findings persist and the small-lane feedback row is created.
2. Big-lane escalation: seed a `pr-merge-collision` scenario (mocked `gh` output), run sweep, assert inbox message to `actor:user` is created with the right metadata.

---

## 11. Manifest + Parity

```json
"unspider": {
  "description": "Hunt contradictions, overlaps, and stale references across the roadmap and code",
  "cli": ["unspider"],
  "sdk": ["unspiderSweep", "unspiderList", "unspiderResolve"],
  "routes": ["POST /unspider/sweep", "GET /unspider/findings", "POST /unspider/findings/:id/resolve"],
  "mcp": ["pd_unspider_sweep"],
  "completions": ["unspider"],
  "docs": { "readme": true, "sdk": true, "adr": "0032" }
}
```

---

## 12. Build Sequence

- [ ] **Phase 1 — Archetype + schema.** Add `UNSPIDER` to archetypes. Add `unspider_findings` DDL.
- [ ] **Phase 2 — Detector lattice.** Implement 8 detectors in `lib/unspider-detectors/`. Unit tests 1–7.
- [ ] **Phase 3 — Severity + routing.** `classify()` + `route()` in `lib/unspider.ts`. Tests 8–9.
- [ ] **Phase 4 — Trigger plumbing.** Wire to activity SSE event stream + daily cron. Budget cap.
- [ ] **Phase 5 — Route + CLI + MCP.** Public surface, parity, integration tests.
- [ ] **Phase 6 — Fleet scheduling.** `fleet/unspider.sh`, `pd fleet up` wiring.

---

## 13. Risks + Mitigations

**Risk: False-positive flood — every commit triggers contradiction warnings.**
Mitigation: confidence threshold per kind (default 0.7). Per-finding-kind allowlist via `~/.port-daddy/unspider-allowlist.yaml`. Operator can mute a kind for N days via `pd unspider --mute doc-code-drift --until 7d`.

**Risk: Big-lane escalations get ignored, defeating the channel.**
Mitigation: big-lane requires explicit operator resolution (`pd unspider --resolve <id>`). Unresolved big findings accumulate visibly in `pd inbox`. If a kind produces ≥3 unresolved big findings, downgrade subsequent ones to small until operator drains the inbox.

**Risk: doc-code-drift over-flags on aspirational README/CHANGELOG content.**
Mitigation: detector skips docs containing tag `<!-- aspirational -->` near the symbol. Per-file mute via the allowlist.

**Risk: stale-memory-path is noisy because memory rewrites are constant.**
Mitigation: only flag memory entries with mtime > 30d (stable enough to expect path correctness). Recent memory edits are excluded.

**Risk: gh-CLI absence breaks `pr-merge-collision` silently.**
Mitigation: detector logs a one-time warning at daemon startup if `gh` is missing. Falls back to local git-merge dry-run for branches in `origin/main..feature/*`.

**Risk: Roadmap migrates to DB (ADR-0033) and detector queries break.**
Mitigation: each detector reads from `lib/roadmap-progress.ts` (already an abstraction). The abstraction's backend swap (files → table) doesn't ripple into detectors.

**Risk: unSpider's adversarial voice grates over time.**
Mitigation: voice register is dry-surgical, not adversarial. Recommendations are actionable; no editorializing.

---

## Consequences

### Positive
- Phase 0 audit-class findings (the doc-code-drift type) become continuous, not quarterly.
- Sortie claim collisions surface BEFORE merge conflicts.
- Spider's drafts get a contradiction check before Cartographer reviews them.
- Stale memory entries get caught instead of leading agents into wrong assumptions.
- The "Single Approver Agent" memory vision gains a concrete substrate — unSpider is the upstream feeder for approve/reject decisions.

### Negative
- 8 new detectors = 8 new failure modes. Each must be muteable.
- `unspider_findings` table grows over time; needs a TTL/archive strategy after 6 months (deferred to ADR-0034).
- Adds another LLM cost lane (≤$0.20/day, capped).
- Operator must manage their `~/.port-daddy/unspider-allowlist.yaml` over time.

---

## PR Title

`feat(unspider): contradiction-finder agent — files bugs, escalates blockers`

## PR Description

- Adds the unSpider archetype to `lib/shipwright/archetypes.ts` and the 8-detector lattice in `lib/unspider-detectors/` (+ `unspider_findings` table).
- `pd unspider [--dry-run] [--since 24h] [--kind <kind>]` sweeps for roadmap collisions, sortie claim overlaps, doc-code drift, stale memory paths, duplicate feedback, orphan cuts, budget-exhausted blockers, and PR merge collisions.
- Two output lanes: `severity='small'` → `feedback.create({source: 'unspider'})`; `severity='big'` → `inbox.send({to: 'actor:user'})` with operator-actionable recommendation prose.
- Detection runs structurally first (grep + SQL range queries). LLM calls only for contradiction judgment on ambiguous cases (cheap classifier, ≤$0.001/call) and for big-lane recommendation prose (Haiku, ≤$0.005/call). Daily budget cap `$0.20`.
- Event-driven triggers on `cartographer.write`, `sortie.completed`, `claim.acquired`, `draft.created:spider`. Daily catch-all cron at 04:15.
- Full CLI/SDK/route/MCP parity. `pd_unspider_sweep` lands in the `routing` MCP category.
- Pairs with Spider (ADR-0031) for generative/critical roadmap maintenance.

---

## Follow-up

**ADR-0033 (proposed):** Migrate Cartographer's 4 markdown files to a SQLite `roadmap_entries` schema. unSpider's `roadmap-collision`, `orphan-cut`, and `doc-code-drift` queries become real SQL joins instead of file-grep cascades. Unlocks ~10x faster sweeps and real-time roadmap-event SSE.

**ADR-0034 (proposed):** `unspider_findings` retention + archive policy. After 180 days, resolved findings move to `unspider_findings_archive` for audit; unresolved findings persist indefinitely (they're still a problem).
