/**
 * roadmap-dedup — merge cross-harbor duplicate `roadmap_items` slugs.
 *
 *   npx tsx scripts/roadmap-dedup.ts                 # dry-run (default), reads the durable-home DB
 *   npx tsx scripts/roadmap-dedup.ts --apply          # actually merges + tombstones
 *   npx tsx scripts/roadmap-dedup.ts --db <path>      # target a specific DB file
 *
 * Why this exists: `UNIQUE(slug, harbor)` (lib/db.ts) only guards one
 * (slug, harbor) pair. Every write surface EXCEPT `pd begin --roadmap-new`
 * (lib/sugar.ts, via `roadmapItems.slugExists()`) upserted a slug scoped
 * only to the harbor it was handed — `POST /roadmap/items` trusting
 * `body.harbor` verbatim, `roadmap-promote` inheriting `fb.harbor`, and
 * `pd roadmap import-markdown` falling back to the DEFAULT_HARBOR when
 * unflagged (fixed alongside this script — see `lib/roadmap-items.ts`'s
 * `upsert()` cross-harbor guard and `cli/commands/roadmap.ts`'s
 * `handleRoadmapImportMarkdown`). The result, live: 77 duplicate slugs
 * spread across dozens of harbors, many of which are session/PR/
 * workflow-run ids rather than real project names.
 *
 * This script is the one-time (re-runnable, idempotent) cleanup for
 * duplicates that ALREADY exist. It:
 *
 *   1. Groups all live (non-tombstoned) rows by slug, across every harbor.
 *   2. For each group with >1 row, picks a canonical row via the SAME
 *      git-worktree-aware harbor resolution `pd roadmap upsert` uses
 *      (`lib/harbor-resolve.ts` — imported, not reimplemented), falling
 *      back to "not a suspicious per-run harbor" then "most recently
 *      touched" when no row's harbor matches the resolved one exactly.
 *   3. Unions `dependencies_json` and merges `notes_json` using the exact
 *      same dedupe-on-(at, by, text) rule `roadmapItems.upsert()` already
 *      uses (`mergeNotes` — imported from `lib/roadmap-items.ts`, not
 *      reimplemented).
 *   4. Backfills the canonical row's `assignee_id` / `status` /
 *      `description_md` / `estimate` / `started_at` / `due_at` from
 *      whichever row in the group was touched most recently (those Planner
 *      columns — ADR-0086 / migration 085 — aren't yet exposed by the
 *      `RoadmapItems` service abstraction, so that one piece is a raw SQL
 *      UPDATE; everything else goes through `roadmapItems.upsert()` /
 *      `.remove()`).
 *   5. Soft-deletes (tombstones) every non-canonical row via the existing
 *      `roadmapItems.remove()` — NEVER a hard DELETE (this registry is a
 *      multi-replica system reconciled by union-merge; see
 *      `scripts/registry-reunify.ts` and `lib/roadmap-items.ts`'s `remove()`
 *      doc comment).
 *
 * Groups where `status` diverges CONTRADICTORILY (one row `done`, another
 * still `now`/`backlog`) or `assignee_id` differs are FLAGGED for human
 * review instead of auto-merged — that shape of divergence more plausibly
 * means genuinely different work happened under a coincidentally-identical
 * title than it means "these are the same duplicate".
 *
 * Defaults to `--dry-run` (no `--apply` flag required to opt IN to
 * dry-run; `--apply` is required to opt OUT of it) so this is safe to run
 * repeatedly against the live daemon DB to inspect what it WOULD do.
 */
import { resolve } from 'node:path';
import Database, { type DatabaseInstance } from '../lib/sqlite-runtime.js';
import { initDatabase, resolveDbPath } from '../lib/db.js';
import { createTupleSpace } from '../lib/tuples.js';
import {
  createRoadmapItems,
  mergeNotes,
  parseJsonArray,
  type RoadmapItems,
  type RoadmapNote,
} from '../lib/roadmap-items.js';
import { isSuspiciousHarbor } from '../lib/harbor-guard.js';
import { resolveHarbor } from '../lib/harbor-resolve.js';
import type { RoadmapRow } from './registry-reunify.js';

// ── Reading ──────────────────────────────────────────────────────────────

/** Read-only: never migrates schema, never writes. Safe against a live daemon DB. */
export function readLiveRows(dbPath: string): RoadmapRow[] {
  const db: DatabaseInstance = new Database(dbPath, { readonly: true });
  try {
    return (db
      .prepare('SELECT * FROM roadmap_items WHERE deleted_at IS NULL')
      .all() as RoadmapRow[]).map((r) => ({ ...r, deleted_at: r.deleted_at ?? null }));
  } finally {
    db.close();
  }
}

export function groupBySlug(rows: RoadmapRow[]): Map<string, RoadmapRow[]> {
  const groups = new Map<string, RoadmapRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.slug);
    if (existing) existing.push(row);
    else groups.set(row.slug, [row]);
  }
  return groups;
}

// ── Planning (pure) ─────────────────────────────────────────────────────

export interface ContradictionCheck {
  contradictory: boolean;
  reasons: string[];
}

/**
 * A group is flagged for human review — never auto-merged — when status
 * diverges CONTRADICTORILY (some row genuinely done, another still active)
 * or when more than one row carries a distinct, real assignee_id. Either
 * shape more plausibly means "two different pieces of work landed under
 * the same title" than "this is the duplicate-slug bug".
 */
export function checkContradiction(rows: RoadmapRow[]): ContradictionCheck {
  const reasons: string[] = [];
  const statuses = new Set(rows.map((r) => r.status));
  if (statuses.has('done') && (statuses.has('now') || statuses.has('backlog'))) {
    reasons.push(`status diverges contradictorily: ${[...statuses].sort().join(', ')}`);
  }
  const assignees = new Set(
    rows.map((r) => r.assignee_id).filter((a): a is string => typeof a === 'string' && a.trim() !== ''),
  );
  if (assignees.size > 1) {
    reasons.push(`assignee_id diverges: ${[...assignees].sort().join(', ')}`);
  }
  return { contradictory: reasons.length > 0, reasons };
}

/**
 * Pick the canonical row for a duplicate-slug group. Precedence:
 *   1. Exact match to the resolved repo harbor (the SAME resolution
 *      `pd roadmap upsert` uses — `resolveHarbor()`, imported).
 *   2. Among rows whose harbor does NOT look like a session/PR/
 *      workflow-run id (`isSuspiciousHarbor`), the most recently touched.
 *   3. If every row's harbor is suspicious, the most recently touched row
 *      overall — better than an arbitrary pick, but the run summary still
 *      surfaces this so a human can rename the harbor later.
 */
export function pickCanonicalRow(rows: RoadmapRow[], repoHarbor: string | undefined): RoadmapRow {
  if (repoHarbor) {
    const exact = rows.find((r) => r.harbor === repoHarbor);
    if (exact) return exact;
  }
  const clean = rows.filter((r) => !isSuspiciousHarbor(r.harbor));
  const pool = clean.length > 0 ? clean : rows;
  return [...pool].sort((a, b) => b.last_touched_at - a.last_touched_at)[0];
}

function mostRecentlyTouched(rows: RoadmapRow[]): RoadmapRow {
  return [...rows].sort((a, b) => b.last_touched_at - a.last_touched_at)[0];
}

function unionDependencies(rows: RoadmapRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const dep of parseJsonArray<string>(row.dependencies_json, [])) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      out.push(dep);
    }
  }
  return out;
}

/** Canonical's own notes first, then every other row's notes merged in via
 *  the SAME (at, by, text) dedupe `roadmapItems.upsert()` already uses. */
function mergeGroupNotes(rows: RoadmapRow[], canonical: RoadmapRow): RoadmapNote[] {
  let merged = parseJsonArray<RoadmapNote>(canonical.notes_json, []);
  for (const row of rows) {
    if (row.id === canonical.id) continue;
    merged = mergeNotes(merged, parseJsonArray<RoadmapNote>(row.notes_json, []));
  }
  return merged;
}

export interface DedupMerge {
  slug: string;
  canonical: RoadmapRow;
  losers: RoadmapRow[];
  mergedDependencies: string[];
  mergedNotes: RoadmapNote[];
  /** Row with the highest last_touched_at in the group — its assignee_id /
   *  status / description_md / estimate / started_at / due_at win. */
  freshest: RoadmapRow;
}

export interface DedupFlagged {
  slug: string;
  rows: RoadmapRow[];
  reasons: string[];
}

export interface DedupPlan {
  merges: DedupMerge[];
  flagged: DedupFlagged[];
  /** Slugs that only had one live row — nothing to do. */
  singletons: number;
}

export function planDedup(rows: RoadmapRow[], opts: { repoHarbor?: string } = {}): DedupPlan {
  const groups = groupBySlug(rows);
  const merges: DedupMerge[] = [];
  const flagged: DedupFlagged[] = [];
  let singletons = 0;

  for (const [slug, groupRows] of groups) {
    if (groupRows.length <= 1) {
      singletons++;
      continue;
    }
    const { contradictory, reasons } = checkContradiction(groupRows);
    if (contradictory) {
      flagged.push({ slug, rows: groupRows, reasons });
      continue;
    }
    const canonical = pickCanonicalRow(groupRows, opts.repoHarbor);
    const losers = groupRows.filter((r) => r.id !== canonical.id);
    merges.push({
      slug,
      canonical,
      losers,
      mergedDependencies: unionDependencies(groupRows),
      mergedNotes: mergeGroupNotes(groupRows, canonical),
      freshest: mostRecentlyTouched(groupRows),
    });
  }

  return { merges, flagged, singletons };
}

// ── Applying (writes — only reached behind --apply) ────────────────────

export interface ApplyDeps {
  roadmapItems: Pick<RoadmapItems, 'upsert' | 'remove'>;
}

export interface DedupApplyResult {
  groupsMerged: number;
  rowsTombstoned: number;
}

/**
 * Writes the plan. `assignee_id` / `description_md` / `estimate` /
 * `started_at` / `due_at` are raw SQL because `roadmapItems.upsert()`
 * intentionally never touches those columns (see `lib/roadmap-items.ts` —
 * they're PD Planner columns, ADR-0086 / migration 085, not yet exposed by
 * the service abstraction). Everything else — summary/status/notes/
 * dependencies/harbor for the canonical row, and the tombstone for every
 * loser — goes through the real `roadmapItems.upsert()` / `.remove()`.
 */
export function applyDedupPlan(db: DatabaseInstance, plan: DedupPlan, deps: ApplyDeps): DedupApplyResult {
  const { roadmapItems } = deps;
  const updatePlannerFieldsStmt = db.prepare(`
    UPDATE roadmap_items
       SET assignee_id = ?, description_md = ?, estimate = ?, started_at = ?, due_at = ?
     WHERE id = ?
  `);

  let groupsMerged = 0;
  let rowsTombstoned = 0;

  for (const merge of plan.merges) {
    const updated = roadmapItems.upsert({
      slug: merge.canonical.slug,
      summaryMd: merge.canonical.summary_md,
      status: merge.freshest.status,
      dependencies: merge.mergedDependencies,
      notes: merge.mergedNotes,
      harbor: merge.canonical.harbor,
    });
    updatePlannerFieldsStmt.run(
      merge.freshest.assignee_id,
      merge.freshest.description_md,
      merge.freshest.estimate,
      merge.freshest.started_at,
      merge.freshest.due_at,
      updated.id,
    );
    for (const loser of merge.losers) {
      const result = roadmapItems.remove(loser.slug, loser.harbor);
      if (result.removed) rowsTombstoned++;
    }
    groupsMerged++;
  }

  return { groupsMerged, rowsTombstoned };
}

// ── Reporting ────────────────────────────────────────────────────────────

export function printPlan(plan: DedupPlan, opts: { apply: boolean }): void {
  console.log('');
  console.log(
    `[roadmap-dedup] ${plan.merges.length} group(s) ${opts.apply ? 'merged' : 'would merge'}, ` +
      `${plan.flagged.length} group(s) flagged for review, ${plan.singletons} singleton slug(s) skipped`,
  );
  console.log('-'.repeat(80));

  if (plan.merges.length > 0) {
    console.log('');
    console.log(`${opts.apply ? 'MERGED' : 'WOULD MERGE'}:`);
    for (const merge of plan.merges) {
      const loserHarbors = merge.losers.map((l) => l.harbor).join(', ');
      console.log(`  - ${merge.slug}`);
      console.log(`      canonical harbor: ${merge.canonical.harbor}`);
      console.log(`      tombstoning:      ${loserHarbors}`);
      if (merge.mergedDependencies.length > 0) {
        console.log(`      dependencies:     ${merge.mergedDependencies.join(', ')}`);
      }
    }
  }

  if (plan.flagged.length > 0) {
    console.log('');
    console.error('FLAGGED FOR HUMAN REVIEW (not touched):');
    for (const group of plan.flagged) {
      console.error(`  - ${group.slug}`);
      for (const reason of group.reasons) console.error(`      ${reason}`);
      for (const row of group.rows) {
        console.error(
          `      harbor=${row.harbor} status=${row.status} assignee=${row.assignee_id ?? '(none)'} ` +
            `touched=${new Date(row.last_touched_at).toISOString()}`,
        );
      }
    }
  }
  console.log('');
}

// ── CLI ──────────────────────────────────────────────────────────────────

interface ParsedArgs {
  apply: boolean;
  dbPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let apply = false;
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--dry-run') apply = false;
    else if (argv[i] === '--db') dbPath = argv[++i];
  }
  return { apply, dbPath };
}

async function main(): Promise<void> {
  const { apply, dbPath: dbPathArg } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(dbPathArg ? resolve(dbPathArg) : undefined);
  const repoHarbor = resolveHarbor({});

  console.log(`[roadmap-dedup] db:    ${dbPath}`);
  console.log(`[roadmap-dedup] mode:  ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`[roadmap-dedup] canonical harbor for this run: ${repoHarbor ?? '(unresolved)'}`);

  const rows = readLiveRows(dbPath);
  console.log(`[roadmap-dedup] read ${rows.length} live roadmap_items row(s)`);

  const plan = planDedup(rows, { repoHarbor });

  if (!apply) {
    printPlan(plan, { apply: false });
    console.log('[roadmap-dedup] dry run — no writes. Re-run with --apply to persist.');
    return;
  }

  // initDatabase applies schema migrations; only reached once we're
  // committed to writing.
  const db: DatabaseInstance = initDatabase({ dbPath });
  try {
    const tuples = createTupleSpace(db);
    const roadmapItems = createRoadmapItems({ db, tuples });
    const result = applyDedupPlan(db, plan, { roadmapItems });
    printPlan(plan, { apply: true });
    console.log(
      `[roadmap-dedup] applied: ${result.groupsMerged} group(s) merged, ` +
        `${result.rowsTombstoned} row(s) tombstoned`,
    );
  } finally {
    db.close();
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]).endsWith('roadmap-dedup.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[roadmap-dedup] FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
