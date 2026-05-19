/**
 * Roadmap Render — markdown projection from the tuple-backed
 * `roadmap_items` source of truth.
 *
 * Slice C of the roadmap-db-of-record initiative. The flow is:
 *
 *   feedback:dropped (high/critical) → cartographer promotes via
 *   `pd roadmap promote` → roadmap_items tuple written → THIS module
 *   renders `docs/ROADMAP.md` from the tuple stream.
 *
 * Doctrine: `docs/ROADMAP.md` becomes a *projection*. The DB is the
 * source. Cartographer no longer edits markdown directly; it calls
 * `pd roadmap render --write` at the end of its pass.
 *
 * The render is **marker-bounded** so human-curated prose around the
 * Next Cuts section is preserved:
 *
 *   ## Next Cuts (From Curated Trove)
 *
 *   <intro paragraph — human-authored, untouched by render>
 *
 *   <!-- pd-roadmap:items-start -->
 *   - **`slug-1`** — summary md
 *   - **`slug-2`** — summary md
 *   <!-- pd-roadmap:items-end -->
 *
 *   <next h2 section, untouched>
 *
 * First-run behavior: if the markers are missing, render inserts them
 * right after the section header (before the next H2) and writes the
 * items between them. Existing prose between the section header and
 * the new markers is preserved as the "intro paragraph."
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RoadmapItem } from './roadmap-items.js';

export const ROADMAP_ITEMS_START_MARKER = '<!-- pd-roadmap:items-start -->';
export const ROADMAP_ITEMS_END_MARKER = '<!-- pd-roadmap:items-end -->';

export const DEFAULT_SECTION_HEADER = '## Next Cuts (From Curated Trove)';

export interface RenderOptions {
  /** Status filter applied to items. Defaults to `now`. */
  /** Default-set value, 'all', or any team-defined workflow string. */
  status?: 'now' | 'backlog' | 'parked' | 'merge' | 'done' | 'quarantined' | 'all' | string;
  /** Maximum items to render. Defaults to all (no cap). */
  limit?: number;
}

export interface ApplyOptions extends RenderOptions {
  /** Section header to anchor the render under. Defaults to `## Next Cuts (From Curated Trove)`. */
  sectionHeader?: string;
}

export interface ApplyResult {
  /** Markdown that ended up on disk after the apply. */
  after: string;
  /** Markdown that was on disk before the apply (empty string if file did not exist). */
  before: string;
  /** True iff the apply changed the file contents. */
  changed: boolean;
  /** Resolved path of `docs/ROADMAP.md`. */
  path: string;
  /** True iff render inserted markers because none were found. */
  insertedMarkers: boolean;
}

/**
 * Render the *contents* between the markers — bullets only, no markers
 * themselves and no surrounding blank lines. Pure function, no I/O.
 */
export function renderNextCutsMarkdown(items: RoadmapItem[], options: RenderOptions = {}): string {
  const status = options.status ?? 'now';
  const filtered = status === 'all' ? items : items.filter((i) => i.status === status);
  const limited =
    typeof options.limit === 'number' && options.limit > 0
      ? filtered.slice(0, options.limit)
      : filtered;

  if (limited.length === 0) {
    return '_(no roadmap items at this status — run `pd roadmap promote` to fold high-severity feedback in)_';
  }

  return limited.map((item) => renderItemBullet(item)).join('\n');
}

function renderItemBullet(item: RoadmapItem): string {
  // Collapse to a single line for tight `- **slug** — summary` shape,
  // but if the summary has explicit paragraphs the caller probably
  // wanted them, so keep newlines as indented continuation lines.
  const lines = item.summaryMd.trim().split('\n');
  const head = lines[0]?.trim() ?? '';
  const continuation = lines
    .slice(1)
    .map((line) => `  ${line.trim()}`)
    .filter((line) => line.trim() !== '')
    .join('\n');
  const body = continuation ? `${head}\n${continuation}` : head;
  return `- **\`${item.slug}\`** — ${body}`;
}

/**
 * Build the full markdown that should sit between (and including) the
 * `pd-roadmap:items-start` and `pd-roadmap:items-end` markers.
 */
function renderMarkerBlock(items: RoadmapItem[], options: RenderOptions): string {
  const content = renderNextCutsMarkdown(items, options);
  return `${ROADMAP_ITEMS_START_MARKER}\n${content}\n${ROADMAP_ITEMS_END_MARKER}`;
}

/**
 * Read the existing markdown, splice the rendered items into the
 * markered block (inserting markers if they are missing), and write
 * the file. Returns before/after for callers that want to diff.
 *
 * Idempotent: re-running with the same input produces no change.
 */
export function applyRoadmapMarkdown(
  rootDir: string,
  items: RoadmapItem[],
  options: ApplyOptions = {},
): ApplyResult {
  const path = join(rootDir, 'docs', 'ROADMAP.md');
  const sectionHeader = options.sectionHeader ?? DEFAULT_SECTION_HEADER;
  const block = renderMarkerBlock(items, options);

  const before = existsSync(path) ? readFileSync(path, 'utf-8') : '';

  // Path 1: markers exist — replace just the block between them.
  const markerRe = new RegExp(
    `${escapeRegex(ROADMAP_ITEMS_START_MARKER)}[\\s\\S]*?${escapeRegex(ROADMAP_ITEMS_END_MARKER)}`,
    'm',
  );
  if (markerRe.test(before)) {
    const after = before.replace(markerRe, block);
    return finishApply(path, before, after, false);
  }

  // Path 2: section header exists but no markers yet — insert markers
  // right before the next H2 header (or at end-of-file if none).
  const headerIdx = before.indexOf(sectionHeader);
  if (headerIdx !== -1) {
    const afterHeader = before.slice(headerIdx);
    const nextH2Match = afterHeader.match(/\n## /);
    const insertAt = nextH2Match
      ? headerIdx + nextH2Match.index!
      : before.length;
    // Walk back over any trailing blank lines so we don't accumulate
    // them across repeated inserts.
    let trimEnd = insertAt;
    while (trimEnd > headerIdx && before[trimEnd - 1] === '\n') trimEnd -= 1;
    const head = before.slice(0, trimEnd);
    const tail = before.slice(insertAt);
    const after = `${head}\n\n${block}\n${tail.startsWith('\n') ? tail : `\n${tail}`}`;
    return finishApply(path, before, after, true);
  }

  // Path 3: neither markers nor section header — append the section
  // and markers at the end. Conservative: this is a fresh repo case.
  const intro =
    '\nMirrored from the tuple-backed `roadmap_items` source of truth. Edits to this block are\n' +
    'overwritten on the next `pd roadmap render`. Promote new entries via `pd roadmap promote`.\n';
  const appended =
    (before.endsWith('\n') ? before : `${before}\n`) +
    `\n${sectionHeader}\n${intro}\n${block}\n`;
  return finishApply(path, before, appended, true);
}

function finishApply(path: string, before: string, after: string, insertedMarkers: boolean): ApplyResult {
  const changed = before !== after;
  if (changed) writeFileSync(path, after, 'utf-8');
  return { path, before, after, changed, insertedMarkers };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
