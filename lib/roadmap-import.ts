/**
 * Roadmap Import — backfill `roadmap_items` from the legacy markdown piles.
 *
 * Why this exists (the bug): ADR-0033 / `lib/roadmap-items.ts` declare the
 * SQLite `roadmap_items` table the source of truth and `docs/ROADMAP.md` a
 * downstream *render*. But the curated piles that predate the table —
 * ROADMAP.md "Next Cuts (From Curated Trove)", IDEAS-TROVE.md entries flagged
 * `now`, and the DOGFOOD-FEEDBACK.md curated list — were never migrated into
 * the table. So `pd roadmap` (which read the markdown) and the table
 * disagreed, and entries could be lost in the gap between them.
 *
 * This module is the one-time (re-runnable) backfill: parse the existing
 * markdown with the SAME parsers the dashboard already uses
 * (`parseNextCuts` / `parseFeedbackEntries` from roadmap-progress.ts — no
 * parallel parser), and upsert each entry into `roadmap_items`.
 *
 * Idempotency: `roadmapItems.upsert` keys on UNIQUE(slug, harbor). A row is
 * written from the markdown exactly once — on first insert. Re-running bumps
 * `last_touched_at` but NEVER rewrites an existing row's summary, status, or
 * `promotedByAgentId`: those may since have been enriched by `pd roadmap
 * promote` or an interactive upsert, and a backfill must not erase real
 * provenance. (Freshly inserted rows get the parsed summary + status `now` +
 * the import agent stamp; everything else is left untouched.) So re-running
 * `pd roadmap import-markdown` is safe even after rows have been promoted.
 *
 * What counts as near-term: Next Cuts are imported wholesale (they are
 * Cartographer's promoted "do this next"); IDEAS-TROVE and DOGFOOD-FEEDBACK
 * are filtered to entries the operator flagged `status: now` — the rest stay
 * in their files as backlog/parked. This keeps the three piles symmetric.
 *
 * Precedence when a slug appears in more than one pile: Next Cuts win over
 * ideas-now, which win over dogfood — Next Cuts are the strongest curated
 * signal. Status defaults to `now` (these are all curated, near-term piles)
 * but an explicit status in the markdown is honored.
 */

import { join, isAbsolute } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import {
  parseNextCuts,
  parseFeedbackEntries,
  loadCartographerConfig,
  type RoadmapProgressPaths,
} from './roadmap-progress.js';
import type { RoadmapItems, RoadmapStatus, UpsertRoadmapItemInput } from './roadmap-items.js';

const DEFAULT_PATHS = {
  roadmap: 'docs/ROADMAP.md',
  ideasTrove: 'docs/recovery/IDEAS-TROVE.md',
  dogfoodFeedback: 'docs/recovery/DOGFOOD-FEEDBACK.md',
};

const VALID_STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];

/** Provenance of a parsed candidate, for the reconcile report. */
export type ImportSource = 'next-cut' | 'ideas-now' | 'dogfood';

export interface ImportCandidate {
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  source: ImportSource;
}

export interface ImportMarkdownInput {
  /** Repo root. Markdown paths resolve against this. Defaults to process.cwd(). */
  rootDir?: string;
  /** Per-file overrides (e.g. for tests). Win over `.cartographer/config.*` + defaults. */
  paths?: Pick<RoadmapProgressPaths, 'roadmap' | 'ideasTrove' | 'dogfoodFeedback'>;
  /** Harbor the imported rows land in. Defaults to the items table default (`fleet`). */
  harbor?: string;
  /** Project shorthand — resolved to `<project>:fleet` when `harbor` is not given. */
  project?: string;
  /** Agent id stamped as `promotedByAgentId` on imported rows. Defaults to `roadmap-import`. */
  by?: string;
  /** When true, parse + report only; do not write to the table. */
  dryRun?: boolean;
}

export interface ImportMarkdownResult {
  /** De-duplicated candidates that were (or would be) upserted, in write order. */
  candidates: ImportCandidate[];
  /** Slugs that were freshly inserted (not present in the table before). */
  inserted: string[];
  /** Slugs that already existed and were updated in place. */
  updated: string[];
  /** Per-source counts before de-duplication, for the report line. */
  parsed: { nextCuts: number; ideasNow: number; dogfood: number };
  /** Files that were missing on disk (skipped, not an error). */
  missingFiles: string[];
  dryRun: boolean;
}

function resolvePath(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}

function readSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function coerceStatus(value: string | undefined, fallback: RoadmapStatus): RoadmapStatus {
  if (value && (VALID_STATUSES as string[]).includes(value)) return value as RoadmapStatus;
  return fallback;
}

/**
 * Parse the three curated markdown piles into a de-duplicated, ordered list
 * of import candidates. Pure: no I/O beyond what the caller hands in.
 *
 * Precedence: next-cut > ideas-now > dogfood. First writer for a slug wins
 * the row; later piles are ignored for that slug (but still counted in
 * `parsed`).
 */
export function collectImportCandidates(input: {
  roadmapMd: string | null;
  ideasTroveMd: string | null;
  dogfoodMd: string | null;
}): { candidates: ImportCandidate[]; parsed: ImportMarkdownResult['parsed'] } {
  const nextCuts = input.roadmapMd ? parseNextCuts(input.roadmapMd) : [];
  // IDEAS-TROVE: only the entries the curator flagged `now` belong on the
  // near-term roadmap. The rest are backlog/parked and stay in the trove.
  const allIdeas = input.ideasTroveMd ? parseFeedbackEntries(input.ideasTroveMd) : [];
  const ideasNow = allIdeas.filter((e) => e.status === 'now');
  // DOGFOOD-FEEDBACK: same rule as ideas-trove. Only entries the operator
  // flagged `now` belong on the near-term roadmap; `backlog`/`parked`/`unknown`
  // dogfood entries stay in the feedback file (parseFeedbackEntries emits
  // `unknown` for any unrecognized status — see roadmap-progress.ts). Filtering
  // here keeps the three piles symmetric and matches the "curated, near-term"
  // framing in this module's header.
  const allDogfood = input.dogfoodMd ? parseFeedbackEntries(input.dogfoodMd) : [];
  const dogfood = allDogfood.filter((e) => e.status === 'now');

  const bySlug = new Map<string, ImportCandidate>();

  // 1. Next cuts — strongest signal, status `now`.
  for (const cut of nextCuts) {
    const slug = cut.slug.trim();
    if (!slug) continue;
    const summaryMd = cut.summary.trim();
    if (!summaryMd) continue;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { slug, summaryMd, status: 'now', source: 'next-cut' });
    }
  }

  // 2. IDEAS-TROVE `now` entries.
  for (const entry of ideasNow) {
    const slug = entry.slug.trim();
    if (!slug) continue;
    if (bySlug.has(slug)) continue;
    const summaryMd = (entry.hook ?? entry.summary ?? entry.surface ?? slug).trim();
    if (!summaryMd) continue;
    bySlug.set(slug, {
      slug,
      summaryMd,
      status: coerceStatus(entry.status, 'now'),
      source: 'ideas-now',
    });
  }

  // 3. Dogfood curated feedback.
  for (const entry of dogfood) {
    const slug = entry.slug.trim();
    if (!slug) continue;
    if (bySlug.has(slug)) continue;
    const summaryMd = (entry.hook ?? entry.summary ?? entry.surface ?? slug).trim();
    if (!summaryMd) continue;
    bySlug.set(slug, {
      slug,
      summaryMd,
      status: coerceStatus(entry.status, 'now'),
      source: 'dogfood',
    });
  }

  return {
    candidates: Array.from(bySlug.values()),
    parsed: { nextCuts: nextCuts.length, ideasNow: ideasNow.length, dogfood: dogfood.length },
  };
}

/**
 * Backfill `roadmap_items` from the markdown piles. Idempotent: re-running
 * updates existing rows in place rather than creating duplicates.
 */
export function importMarkdownRoadmap(
  roadmapItems: RoadmapItems,
  input: ImportMarkdownInput = {},
): ImportMarkdownResult {
  const root = input.rootDir ?? process.cwd();

  // Honor `.cartographer/config.*` overrides the same way roadmap-progress
  // does, so the import reads the same files the dashboard reads.
  const cfg = loadCartographerConfig(root);
  const roadmapRel = input.paths?.roadmap ?? cfg.paths.roadmap ?? DEFAULT_PATHS.roadmap;
  const ideasRel = input.paths?.ideasTrove ?? cfg.paths.ideasTrove ?? DEFAULT_PATHS.ideasTrove;
  const dogfoodRel =
    input.paths?.dogfoodFeedback ?? cfg.paths.dogfoodFeedback ?? DEFAULT_PATHS.dogfoodFeedback;

  const roadmapPath = resolvePath(root, roadmapRel);
  const ideasPath = resolvePath(root, ideasRel);
  const dogfoodPath = resolvePath(root, dogfoodRel);

  const roadmapMd = readSafe(roadmapPath);
  const ideasTroveMd = readSafe(ideasPath);
  const dogfoodMd = readSafe(dogfoodPath);

  const missingFiles: string[] = [];
  if (roadmapMd === null) missingFiles.push(roadmapPath);
  if (ideasTroveMd === null) missingFiles.push(ideasPath);
  if (dogfoodMd === null) missingFiles.push(dogfoodPath);

  const { candidates, parsed } = collectImportCandidates({ roadmapMd, ideasTroveMd, dogfoodMd });

  const inserted: string[] = [];
  const updated: string[] = [];
  const by = input.by ?? 'roadmap-import';

  // Resolve the harbor the items table will use, so the pre-existence check
  // queries the same row the upsert will hit.
  const harbor = input.harbor ?? (input.project ? `${input.project}:fleet` : undefined);

  for (const candidate of candidates) {
    const existing = roadmapItems.get(candidate.slug, harbor);
    if (existing) updated.push(candidate.slug);
    else inserted.push(candidate.slug);

    if (input.dryRun) continue;

    // Provenance / summary preservation. The import is a backfill, not an
    // edit: it must never erase richer data recorded by `pd roadmap promote`
    // or an interactive upsert. `roadmapItems.upsert` keeps existing
    // `promotedByAgentId` only when we pass it null/undefined, so for a row
    // that already exists we OMIT `promotedByAgentId` (preserving the real
    // promoter) and keep the existing summary verbatim rather than rewriting
    // it with the markdown bullet. Fresh inserts get the import stamp + the
    // parsed summary. (See the idempotency contract in this file's header.)
    const upsertInput: UpsertRoadmapItemInput = existing
      ? {
          slug: candidate.slug,
          summaryMd: existing.summaryMd,
          // Preserve the existing status — a re-import never demotes/promotes.
          status: existing.status,
        }
      : {
          slug: candidate.slug,
          summaryMd: candidate.summaryMd,
          status: candidate.status,
          promotedByAgentId: by,
        };
    if (input.harbor) upsertInput.harbor = input.harbor;
    if (!input.harbor && input.project) upsertInput.project = input.project;
    roadmapItems.upsert(upsertInput);
  }

  return {
    candidates,
    inserted,
    updated,
    parsed,
    missingFiles,
    dryRun: Boolean(input.dryRun),
  };
}
