/**
 * Roadmap Chomp — general planning-doc ingestion into the roadmap DB-of-record.
 *
 * Why this exists (operator mandate, 2026-08-22): planning documents pile up in
 * the repo (PLAN.md, V4-DAG.md, one-off proposal docs…) while ADR-0033 says the
 * SQLite `roadmap_items` table is the source of truth and markdown is a render.
 * The intended flow is: hand the daemon a planning doc, "chomp" it into
 * first-class roadmap items (with hierarchy and dependencies), then open a PR
 * that adds the items (as a regenerated snapshot) and REMOVES the source doc
 * from the repo. `pd roadmap chomp <path…>` is that ingestion verb.
 *
 * Design / philosophy — one parser, three shapes:
 *
 *   This module SUPPLANTS the old fixed-3-source `lib/roadmap-import.ts`
 *   (per the repo's no-parallel-paths doctrine there is exactly ONE markdown
 *   →roadmap ingestion path). The three legacy curated piles — ROADMAP.md
 *   "Next Cuts", IDEAS-TROVE.md `now` entries, DOGFOOD-FEEDBACK.md `now`
 *   entries — are handled here as two *document formats* the chomper detects
 *   (`next-cuts-pile`, `entry-pile`), parsed with the SAME shared parsers the
 *   dashboard uses (`parseNextCuts` / `parseFeedbackEntries` from
 *   roadmap-progress.ts — still no parallel parser). Everything else is a
 *   `planning-doc`: ATX headings become a project→epic→story→task ladder,
 *   checklists become tasks, and explicit "depends on …" phrasing becomes
 *   dependencies. `importMarkdownRoadmap` survives as a thin legacy alias that
 *   chomps the three canonical paths and adapts the result shape.
 *
 * Extraction is DETERMINISTIC first: headings→hierarchy, checklists→tasks,
 * explicit dependency phrasing→edges, filename→tag. Where judgment helps
 * (compressing a long section body into a one-line summary), the caller may
 * pass an `enrich` transport that routes through the daemon's real request-
 * shape LLM path (`lib/llm-backend-resolver.ts` → `lib/llm-call.ts` adapters,
 * the same path the coordination judge uses). Enrichment is strictly optional
 * and fail-open: no backend, timeout, or error ⇒ the deterministic extraction
 * ships unchanged. Nothing is faked when no backend is configured.
 *
 * Idempotency & enriched-row protection (same contract the legacy importer
 * documented): `roadmapItems.upsert` keys on UNIQUE(slug, harbor). A chomp
 * writes a row's parsed content exactly once — on first insert. Re-running
 * bumps `last_touched_at` but NEVER rewrites an existing row's summary,
 * status, kind, description, dependencies, notes, or `promotedByAgentId`:
 * those may since have been enriched by `pd roadmap promote` or an
 * interactive upsert, and a re-chomp must not erase real provenance.
 *
 * Hierarchy & dependency storage:
 *   - `depends_on` lands in the item row's `dependencies` column — the
 *     DB-of-record field `derivePlan` (lib/planner-migrate.ts) already reads
 *     and projects into graph_edges on every board render. Chomp does NOT
 *     write `planner:deps` edges directly; the row is the record, the edge is
 *     the projection (single-writer discipline).
 *   - `parent_of` edges are written via `lib/planner-edges.ts` constructors
 *     into the ADR-0086 §3 `planner:hierarchy` scope with idempotent
 *     `graphEdges.remember` upserts. KNOWN LIMITATION (stated honestly): the
 *     `/roadmap/board` route re-derives hierarchy from ADR slug conventions
 *     and `replaceScope`s that scope on render, which supersedes chomp-written
 *     heading hierarchy until `derivePlan` learns to read it — tracked as a
 *     follow-up in the chomp PR, not silently papered over.
 */

import { join, isAbsolute, resolve, relative, basename } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import {
  parseNextCuts,
  parseFeedbackEntries,
  loadCartographerConfig,
} from './roadmap-progress.js';
import type {
  RoadmapItems,
  RoadmapStatus,
  RoadmapKind,
  RoadmapSourceRef,
  UpsertRoadmapItemInput,
} from './roadmap-items.js';
import { parentEdge } from './planner-edges.js';
import type { GraphEdges } from './graph-edges.js';
import type { LLMTransport } from './llm-backend-resolver.js';

// ────── Shared vocabulary ──────

const VALID_STATUSES: RoadmapStatus[] = ['now', 'backlog', 'parked', 'merge', 'done'];

/** The three canonical legacy pile paths `importMarkdownRoadmap` chomps. */
const LEGACY_PATHS = {
  roadmap: 'docs/ROADMAP.md',
  ideasTrove: 'docs/recovery/IDEAS-TROVE.md',
  dogfoodFeedback: 'docs/recovery/DOGFOOD-FEEDBACK.md',
};

/**
 * Document formats the chomper understands. Detection is content-based so any
 * repo's curated piles keep importing identically through the general path:
 * a "## Next Cuts" section marks the ROADMAP.md pile shape; backticked
 * `### \`slug\`` entries with `- status:` bullets mark the trove/dogfood
 * shape; everything else is a free-form planning doc.
 */
export type ChompDocFormat = 'planning-doc' | 'next-cuts-pile' | 'entry-pile';

/** Provenance of a legacy import candidate, kept for the reconcile report. */
export type ImportSource = 'next-cut' | 'ideas-now' | 'dogfood';

export interface ChompedItem {
  slug: string;
  kind: RoadmapKind;
  summaryMd: string;
  /** Verbatim direct section body (text up to the next heading), or null. */
  descriptionMd: string | null;
  status: RoadmapStatus;
  /** Slug of the parent item within the same chomp run (heading nesting). */
  parent: string | null;
  /** Raw dependency tokens extracted from explicit phrasing; resolved later. */
  dependsOn: string[];
  /** Tags derived from the source doc's filename. */
  tags: string[];
  sourcePath: string;
  /** Original heading text (null for checklist tasks and pile rows). */
  heading: string | null;
  /** Normalized nesting depth (0 = doc root). */
  depth: number;
}

export interface ChompedDoc {
  sourcePath: string;
  format: ChompDocFormat;
  items: ChompedItem[];
  warnings: string[];
}

// ────── Pure text helpers ──────

/**
 * Kebab-case a heading into a slug.
 *
 * Why: roadmap slugs are the UNIQUE(slug, harbor) identity, so the mapping
 * from heading text must be deterministic and stable across re-chomps —
 * idempotency depends on it. Markdown decoration (bold, code, links) is
 * stripped first so `## **Phase 1:** Build` and `## Phase 1: Build` collide
 * on purpose. If the heading is already a single backticked slug-looking
 * token (the house `### \`my-slug\`` convention), it is used verbatim.
 *
 * @param text - Raw heading or checklist text.
 * @returns A lowercase kebab slug (possibly empty when the text has no
 *   alphanumerics — callers must skip those).
 */
export function slugifyHeading(text: string): string {
  const trimmed = text.trim();
  const backticked = trimmed.match(/^`([^`]+)`$/);
  if (backticked && /^[a-z0-9][a-z0-9-]*$/.test(backticked[1])) return backticked[1];
  const cleaned = trimmed
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links → label
    .replace(/[*_~]/g, '');
  return cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/**
 * Strip markdown decoration from heading text for use as a summary line.
 *
 * Motivation: `summary_md` is the item's title (migration 085 keeps the rich
 * body in `description_md`), so the heading should read as plain prose there
 * rather than carrying `**`/backtick noise into every list render.
 *
 * @param text - Raw heading text.
 * @returns The heading with links flattened to their labels and emphasis
 *   markers removed, whitespace-collapsed.
 */
function cleanHeadingText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a normalized heading depth to the fixed issue-kind ladder.
 *
 * Design intent: the mandate infers kind from nesting depth — a doc's top
 * heading is the project, its sections are epics, subsections stories, and
 * anything deeper (plus checklist entries) is a task. Depths are normalized
 * to the shallowest heading present so a doc that starts at `##` still gets
 * a project root instead of an orphaned epic layer.
 *
 * @param depth - Zero-based normalized nesting depth.
 * @returns The `roadmap_items.kind` value for that depth.
 */
export function kindForDepth(depth: number): RoadmapKind {
  if (depth <= 0) return 'project';
  if (depth === 1) return 'epic';
  if (depth === 2) return 'story';
  return 'task';
}

/**
 * Extract explicit dependency slugs from prose.
 *
 * Why explicit-only: chomp is deterministic-first — it reads dependency
 * *statements* ("depends on `x`", "blocked by y-z", "requires: `a`, `b`"),
 * never guesses relationships from adjacency. Backticked tokens always
 * qualify; bare tokens only when they look like kebab slugs (contain a
 * hyphen), which keeps ordinary words after "requires" out of the graph.
 *
 * @param text - Section body or checklist line to scan.
 * @returns De-duplicated candidate slug tokens in first-seen order.
 */
export function extractDependsOn(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const phraseRe = /\b(?:depends[ -]on|blocked[ -]by|requires)\b[:\s]*([^\n.;]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = phraseRe.exec(text)) !== null) {
    const segment = m[1];
    const tokens: string[] = [];
    const tickRe = /`([^`]+)`/g;
    let t: RegExpExecArray | null;
    while ((t = tickRe.exec(segment)) !== null) tokens.push(t[1].trim());
    const stripped = segment.replace(/`[^`]*`/g, ' ');
    const bareRe = /\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g;
    let b: RegExpExecArray | null;
    while ((b = bareRe.exec(stripped)) !== null) tokens.push(b[0]);
    for (const token of tokens) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      found.push(token);
    }
  }
  return found;
}

/**
 * Coerce a parsed status token to the roadmap enum.
 *
 * Why: doc authors write arbitrary strings; the design falls back rather
 * than throws so one typo'd status never aborts a whole chomp.
 *
 * @param value - Raw token from the markdown (may be anything).
 * @param fallback - Status used when the token is absent/invalid.
 * @returns A valid {@link RoadmapStatus}.
 */
function coerceStatus(value: string | undefined, fallback: RoadmapStatus): RoadmapStatus {
  if (value && (VALID_STATUSES as string[]).includes(value)) return value as RoadmapStatus;
  return fallback;
}

/**
 * Derive the provenance tag for a chomped doc from its filename.
 *
 * Purpose: the mandate tags every extracted item with its source doc so the
 * operator can trace "where did this item come from" after the doc itself is
 * removed from the repo. The tag is the kebab-cased basename sans extension.
 *
 * @param path - Source doc path (any form).
 * @returns A kebab tag, or null when the basename yields no alphanumerics.
 */
export function tagForDocPath(path: string): string | null {
  const base = basename(path).replace(/\.[^.]+$/, '');
  const tag = slugifyHeading(base);
  return tag || null;
}

/**
 * Content-detect which of the three understood shapes a markdown doc is.
 *
 * Why content (not filename): the legacy importer hardcoded three paths; the
 * general chomper must import those same piles *identically* wherever they
 * live, so the pile shapes are recognized by their structure — the exact
 * structures `parseNextCuts` / `parseFeedbackEntries` were built for.
 *
 * @param markdown - Full doc text.
 * @returns The detected {@link ChompDocFormat}.
 */
export function detectChompFormat(markdown: string): ChompDocFormat {
  if (/^##\s+Next Cuts/m.test(markdown)) return 'next-cuts-pile';
  if (/^###\s+`[^`]+`\s*$/m.test(markdown) && /^\s*-\s+status:/im.test(markdown)) {
    return 'entry-pile';
  }
  return 'planning-doc';
}

export interface ChompDocOptions {
  sourcePath: string;
  /** Provenance tag(s) attached to every item. Default: filename-derived. */
  tags?: string[];
  /** Status for planning-doc items with no explicit status. Default 'backlog'. */
  defaultStatus?: RoadmapStatus;
  /** Force a format instead of content detection (legacy alias uses this). */
  format?: ChompDocFormat;
}

interface HeadingSection {
  level: number;
  text: string;
  bodyLines: string[];
}

/**
 * Split a markdown doc into heading sections with their DIRECT bodies.
 *
 * Design: a section's body is the text up to the next heading of ANY level —
 * child sections belong to child items, so the parent's `description_md`
 * never duplicates its children. Fenced code blocks are tracked so a `#`
 * inside ``` fences is never mistaken for a heading.
 *
 * @param markdown - Full doc text.
 * @returns The pre-heading preamble lines plus ordered heading sections
 *   (level, raw text, direct body lines).
 */
function splitHeadingSections(markdown: string): { preamble: string[]; sections: HeadingSection[] } {
  const preamble: string[] = [];
  const sections: HeadingSection[] = [];
  let inFence = false;
  let current: HeadingSection | null = null;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (h) {
      current = { level: h[1].length, text: h[2], bodyLines: [] };
      sections.push(current);
      continue;
    }
    (current ? current.bodyLines : preamble).push(line);
  }
  return { preamble, sections };
}

const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/;

/**
 * Chomp one markdown document into structured roadmap-item candidates.
 *
 * This is the PURE extraction core — no filesystem, no DB, no network — a
 * deliberate design so tests can assert the exact item tree from a string
 * fixture. Format dispatch: pile shapes go through the shared
 * roadmap-progress parsers (identical to the legacy importer's reads);
 * planning docs get the headings→ladder / checklists→tasks / explicit-deps
 * extraction described in the module header.
 *
 * @param markdown - Full doc text.
 * @param options - Source path, tags, default status, optional format override.
 * @returns The chomped doc: format, ordered items, and parse warnings.
 */
export function chompMarkdownDoc(markdown: string, options: ChompDocOptions): ChompedDoc {
  const format = options.format ?? detectChompFormat(markdown);
  const tags = options.tags ?? (tagForDocPath(options.sourcePath) ? [tagForDocPath(options.sourcePath)!] : []);
  const defaultStatus = options.defaultStatus ?? 'backlog';
  const warnings: string[] = [];
  const items: ChompedItem[] = [];

  if (format === 'next-cuts-pile') {
    // Curated near-term pile: every cut is a `now` task (legacy semantics).
    for (const cut of parseNextCuts(markdown)) {
      const slug = cut.slug.trim();
      const summaryMd = cut.summary.trim();
      if (!slug || !summaryMd) continue;
      items.push({
        slug,
        kind: 'task',
        summaryMd,
        descriptionMd: null,
        status: 'now',
        parent: null,
        dependsOn: [],
        tags,
        sourcePath: options.sourcePath,
        heading: null,
        depth: 0,
      });
    }
    return { sourcePath: options.sourcePath, format, items, warnings };
  }

  if (format === 'entry-pile') {
    // Trove/dogfood pile: only operator-flagged `now` entries belong on the
    // near-term roadmap; the rest stay in the file as backlog/parked
    // (legacy filter, kept so the piles import identically).
    const entries = parseFeedbackEntries(markdown).filter((e) => e.status === 'now');
    for (const entry of entries) {
      const slug = entry.slug.trim();
      if (!slug) continue;
      const summaryMd = (entry.hook ?? entry.summary ?? entry.surface ?? slug).trim();
      if (!summaryMd) continue;
      items.push({
        slug,
        kind: 'task',
        summaryMd,
        descriptionMd: null,
        status: coerceStatus(entry.status, 'now'),
        parent: null,
        dependsOn: [],
        tags,
        sourcePath: options.sourcePath,
        heading: null,
        depth: 0,
      });
    }
    return { sourcePath: options.sourcePath, format, items, warnings };
  }

  // ── planning-doc: headings → ladder, checklists → tasks ──
  const { sections } = splitHeadingSections(markdown);
  if (sections.length === 0) {
    warnings.push(`${options.sourcePath}: no headings found — nothing to chomp`);
    return { sourcePath: options.sourcePath, format, items, warnings };
  }

  const minLevel = Math.min(...sections.map((s) => s.level));
  const usedSlugs = new Set<string>();
  /**
   * De-duplicate slugs within one doc by numeric suffix.
   *
   * Why: two sections titled "Testing" must not silently collapse into one
   * roadmap row — the design keeps both and flags the collision as a
   * warning the operator can rename away.
   *
   * @param base - The kebab slug derived from the heading.
   * @returns The base slug, or `base-N` when already taken.
   */
  const uniqueSlug = (base: string): string => {
    if (!usedSlugs.has(base)) {
      usedSlugs.add(base);
      return base;
    }
    let n = 2;
    while (usedSlugs.has(`${base}-${n}`)) n += 1;
    const slug = `${base}-${n}`;
    usedSlugs.add(slug);
    warnings.push(`${options.sourcePath}: duplicate heading slug '${base}' → '${slug}'`);
    return slug;
  };

  // Stack of (depth, slug) for parent resolution via heading nesting.
  const stack: Array<{ depth: number; slug: string }> = [];

  for (const section of sections) {
    const depth = section.level - minLevel;
    const baseSlug = slugifyHeading(section.text);
    if (!baseSlug) {
      warnings.push(`${options.sourcePath}: heading '${section.text}' yields no slug — skipped`);
      continue;
    }
    const slug = uniqueSlug(baseSlug);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].slug : null;
    stack.push({ depth, slug });

    const body = section.bodyLines.join('\n').trim();
    const statusMatch = body.match(/^\s*-\s+status:\s*`?(\w+)`?\s*$/im);
    const status = coerceStatus(statusMatch?.[1]?.toLowerCase(), defaultStatus);

    // Dependencies from the body EXCLUDING checklist lines — a checklist
    // line's dependency belongs to the checklist task extracted below.
    const bodySansChecklist = section.bodyLines
      .filter((l) => !CHECKBOX_RE.test(l))
      .join('\n');

    items.push({
      slug,
      kind: kindForDepth(depth),
      summaryMd: cleanHeadingText(section.text) || slug,
      descriptionMd: body || null,
      status,
      parent,
      dependsOn: extractDependsOn(bodySansChecklist),
      tags,
      sourcePath: options.sourcePath,
      heading: section.text,
      depth,
    });

    // Checklist entries in the direct body become child tasks. Checked boxes
    // are recorded as done (they are history worth keeping, not re-doing).
    for (const line of section.bodyLines) {
      const box = line.match(CHECKBOX_RE);
      if (!box) continue;
      const text = box[2].trim();
      const taskBase = slugifyHeading(text);
      if (!taskBase) continue;
      const taskSlug = uniqueSlug(taskBase);
      items.push({
        slug: taskSlug,
        kind: 'task',
        summaryMd: cleanHeadingText(text) || taskSlug,
        descriptionMd: null,
        status: box[1].toLowerCase() === 'x' ? 'done' : defaultStatus,
        parent: slug,
        dependsOn: extractDependsOn(text),
        tags,
        sourcePath: options.sourcePath,
        heading: null,
        depth: depth + 1,
      });
    }
  }

  return { sourcePath: options.sourcePath, format, items, warnings };
}

// ────── Multi-doc collection ──────

export interface ChompCollectInput {
  /** Repo root. Relative doc paths resolve against this. Default cwd. */
  rootDir?: string;
  /** Doc paths to chomp, in precedence order (first writer wins per slug). */
  paths: string[];
  /** Default status for planning-doc items. Default 'backlog'. */
  defaultStatus?: RoadmapStatus;
  /** Per-path format overrides (legacy alias forces pile formats). */
  formats?: Record<string, ChompDocFormat>;
  /** Per-path tag overrides. `[]` means "no provenance tag" (legacy alias). */
  tagsByPath?: Record<string, string[]>;
}

export interface ChompDocReport {
  path: string;
  format: ChompDocFormat | null;
  /** Items parsed from this doc BEFORE cross-doc de-duplication. */
  parsed: number;
  missing: boolean;
}

export interface ChompCollection {
  docs: ChompDocReport[];
  /** De-duplicated candidates in write order (first doc wins per slug). */
  items: ChompedItem[];
  missingFiles: string[];
  warnings: string[];
}

/**
 * Read a file, returning null on absence or IO error.
 *
 * Rationale: a missing pile/doc is a reportable condition (`missingFiles`),
 * never a crash — the chomp's job is to ingest what exists and say what
 * didn't.
 *
 * @param path - Absolute file path.
 * @returns File contents, or null when unreadable.
 */
function readSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read + chomp a set of docs and merge them into one candidate list.
 *
 * Precedence philosophy (inherited from the legacy importer's next-cut >
 * ideas-now > dogfood rule, generalized): docs are processed in the order
 * given and the FIRST doc to produce a slug owns that row; later duplicates
 * are dropped with a warning but still counted in that doc's `parsed` total,
 * so the report shows what each doc contributed pre-dedupe.
 *
 * Path safety: relative paths must stay under `rootDir` — a `../` escape is
 * skipped with a warning rather than read, because the daemon resolves these
 * on behalf of a CLI caller. Absolute paths are honored as explicit intent
 * (same trust stance as the legacy importer's path overrides).
 *
 * @param input - Root, ordered paths, and per-path overrides.
 * @returns Per-doc reports plus the merged, de-duplicated item list.
 */
export function collectChompDocs(input: ChompCollectInput): ChompCollection {
  const root = input.rootDir ?? process.cwd();
  const docs: ChompDocReport[] = [];
  const items: ChompedItem[] = [];
  const missingFiles: string[] = [];
  const warnings: string[] = [];
  const bySlug = new Set<string>();

  for (const rawPath of input.paths) {
    const abs = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
    if (!isAbsolute(rawPath) && !abs.startsWith(resolve(root) + '/') && abs !== resolve(root)) {
      warnings.push(`${rawPath}: escapes rootDir — skipped`);
      docs.push({ path: rawPath, format: null, parsed: 0, missing: true });
      continue;
    }
    // Normalize to a rootDir-relative path BEFORE it is persisted. `sourcePath`
    // becomes `source_refs_json.path` on every derived row (and the provenance
    // note, and the work receipt), and that field's contract is "repo-relative"
    // — a caller who passes an absolute path (honored above as explicit intent)
    // would otherwise commit their local filesystem layout into shared roadmap
    // data, and the citation would not resolve on anyone else's checkout. It
    // also makes this agree with `remove-docs.txt`, which already relativizes.
    // A path genuinely outside rootDir has no honest repo-relative form, so it
    // is preserved verbatim rather than emitted as a meaningless `../..` walk.
    const rootAbs = resolve(root);
    const relPath = abs.startsWith(rootAbs + '/') ? relative(rootAbs, abs) : rawPath;
    const markdown = readSafe(abs);
    if (markdown === null) {
      missingFiles.push(abs);
      docs.push({ path: relPath, format: null, parsed: 0, missing: true });
      continue;
    }
    const doc = chompMarkdownDoc(markdown, {
      sourcePath: relPath,
      defaultStatus: input.defaultStatus,
      format: input.formats?.[rawPath],
      tags: input.tagsByPath?.[rawPath],
    });
    warnings.push(...doc.warnings);
    docs.push({ path: relPath, format: doc.format, parsed: doc.items.length, missing: false });
    for (const item of doc.items) {
      if (bySlug.has(item.slug)) {
        warnings.push(`${rawPath}: slug '${item.slug}' already chomped from an earlier doc — first wins`);
        continue;
      }
      bySlug.add(item.slug);
      items.push(item);
    }
  }

  return { docs, items, missingFiles, warnings };
}

// ────── Optional LLM enrichment (the daemon's real request-shape path) ──────

export interface ChompEnrichOptions {
  /** Transport from `resolveLLMBackend` (or an injected test double). */
  transport: LLMTransport;
  /** Model id threaded to the transport ('' lets the transport default). */
  model?: string;
  /** Human-readable backend label for the report. */
  label?: string;
  /** Max items to enrich per run (cost bound). Default 12. */
  maxItems?: number;
  /** Per-call timeout ms. Default 5000. */
  timeoutMs?: number;
}

export interface ChompEnrichment {
  requested: boolean;
  attempted: number;
  applied: number;
  backend: string | null;
}

/**
 * Polish weak summaries through the daemon's real LLM path — judgment only,
 * never structure.
 *
 * Rationale: heading text is a fine title, but a long section body often
 * carries the actual point. Where an item's summary is just its heading AND
 * the body is substantial, one bounded completion asks for a single-line
 * summary. Everything structural (slugs, kinds, hierarchy, dependencies,
 * statuses) stays deterministic; a failed/slow/absent backend leaves the
 * deterministic summary in place (fail-open, mirroring the judge's
 * fallback-deny posture — no fabricated output, ever).
 *
 * @param items - Chomped candidates (mutated in place: `summaryMd` only).
 * @param options - Transport + bounds.
 * @returns Counts of attempted/applied enrichments for the report.
 */
export async function enrichChompedItems(
  items: ChompedItem[],
  options: ChompEnrichOptions,
): Promise<ChompEnrichment> {
  const maxItems = options.maxItems ?? 12;
  const timeoutMs = options.timeoutMs ?? 5000;
  let attempted = 0;
  let applied = 0;
  for (const item of items) {
    if (attempted >= maxItems) break;
    const body = item.descriptionMd ?? '';
    const summaryIsHeading = item.heading !== null && item.summaryMd === cleanHeadingText(item.heading);
    if (!summaryIsHeading || body.length < 240) continue;
    attempted += 1;
    try {
      const result = await options.transport.complete({
        prompt:
          `Summarize this roadmap item in ONE plain sentence under 120 characters. ` +
          `Reply with only the sentence.\n\nTitle: ${item.summaryMd}\n\n${body.slice(0, 4000)}`,
        model: options.model ?? '',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = result.ok ? result.text?.trim().split('\n')[0]?.trim() : undefined;
      if (text && text.length > 0 && text.length <= 200) {
        item.summaryMd = text;
        applied += 1;
      }
    } catch {
      // fail-open: keep the deterministic summary.
    }
  }
  return {
    requested: true,
    attempted,
    applied,
    backend: options.label ?? options.transport.label ?? null,
  };
}

// ────── Write layer ──────

export interface ChompWriteInput {
  /** Harbor the rows land in. Wins over `project`. */
  harbor?: string;
  /** Project shorthand — resolved to `<project>:fleet` when `harbor` absent. */
  project?: string;
  /** Agent id stamped as `promotedByAgentId` on FRESH rows. Default 'roadmap-chomp'. */
  by?: string;
  /** Parse + report only; write nothing. */
  dryRun?: boolean;
  /**
   * Commit SHA of the repo the docs were read from, recorded in each fresh
   * row's `source_refs_json` — the doc is about to be deleted by the chomp
   * PR, so the ref pins the exact revision the item was derived from.
   */
  sourceCommit?: string;
}

export interface ChompItemReport {
  slug: string;
  kind: RoadmapKind;
  status: RoadmapStatus;
  summaryMd: string;
  descriptionMd: string | null;
  parent: string | null;
  dependsOn: string[];
  tags: string[];
  sourcePath: string;
  depth: number;
  action: 'inserted' | 'updated';
  /** True when the row pre-existed: parsed fields were NOT applied. */
  protected: boolean;
}

export interface ChompWriteResult {
  items: ChompItemReport[];
  inserted: string[];
  updated: string[];
  parentEdges: Array<{ parent: string; child: string }>;
  parentEdgesWritten: number;
  dangling: Array<{ slug: string; missing: string }>;
  dryRun: boolean;
}

/**
 * Persist chomped candidates into `roadmap_items` (+ hierarchy edges).
 *
 * The write discipline is the whole purpose of this function (see the module
 * header's idempotency contract): a pre-existing (slug, harbor) row is only
 * touched — its summary/status/kind/description/deps/notes/promoter are
 * passed back verbatim so nothing an agent enriched is ever overwritten by a
 * re-chomp. Fresh rows get the full parsed payload, the `by` agent stamp,
 * and a provenance note naming the source doc + tags (roadmap_items has no
 * tags column; the append-only note is the honest home for provenance until
 * one exists). Dependency tokens are resolved against the run's own slugs
 * plus the live table (`slugExists`); unresolvable tokens are reported as
 * dangling, mirroring `derivePlan`'s dangling-deps discipline, not silently
 * written. Hierarchy edges go through `lib/planner-edges.parentEdge` with
 * idempotent `remember` upserts (see the module header for the board-render
 * caveat).
 *
 * @param roadmapItems - The roadmap DB-of-record primitive.
 * @param graphEdges - graph_edges primitive, or undefined (edges skipped).
 * @param items - Candidates from {@link collectChompDocs} (post-enrichment).
 * @param input - Harbor/agent/dry-run options.
 * @returns Per-item actions, edge counts, and dangling-dependency reports.
 */
export function writeChompedItems(
  roadmapItems: RoadmapItems,
  graphEdges: GraphEdges | undefined,
  items: ChompedItem[],
  input: ChompWriteInput = {},
): ChompWriteResult {
  const by = input.by ?? 'roadmap-chomp';
  const harbor = input.harbor ?? (input.project ? `${input.project}:fleet` : undefined);
  const runSlugs = new Set(items.map((i) => i.slug));

  const reports: ChompItemReport[] = [];
  const inserted: string[] = [];
  const updated: string[] = [];
  const dangling: Array<{ slug: string; missing: string }> = [];
  const parentEdges: Array<{ parent: string; child: string }> = [];
  let parentEdgesWritten = 0;

  for (const item of items) {
    const existing = roadmapItems.get(item.slug, harbor);
    if (existing) updated.push(item.slug);
    else inserted.push(item.slug);

    const resolvedDeps: string[] = [];
    for (const dep of item.dependsOn) {
      if (dep === item.slug) continue;
      if (runSlugs.has(dep) || roadmapItems.slugExists(dep)) resolvedDeps.push(dep);
      else dangling.push({ slug: item.slug, missing: dep });
    }

    if (item.parent) parentEdges.push({ parent: item.parent, child: item.slug });

    reports.push({
      slug: item.slug,
      kind: item.kind,
      status: existing ? existing.status : item.status,
      summaryMd: existing ? existing.summaryMd : item.summaryMd,
      descriptionMd: existing ? existing.descriptionMd : item.descriptionMd,
      parent: item.parent,
      dependsOn: resolvedDeps,
      tags: item.tags,
      sourcePath: item.sourcePath,
      depth: item.depth,
      action: existing ? 'updated' : 'inserted',
      protected: Boolean(existing),
    });

    if (input.dryRun) continue;

    // Provenance / enrichment preservation: a chomp is a backfill, not an
    // editor. Existing rows keep EVERYTHING (we echo summary/status back and
    // omit the rest so upsert preserves it); fresh rows get the full parse.
    const upsertInput: UpsertRoadmapItemInput = existing
      ? {
          slug: item.slug,
          summaryMd: existing.summaryMd,
          status: existing.status,
        }
      : {
          slug: item.slug,
          summaryMd: item.summaryMd,
          status: item.status,
          kind: item.kind,
          descriptionMd: item.descriptionMd ?? undefined,
          dependencies: resolvedDeps,
          promotedByAgentId: by,
          // Durable provenance: the derived row points back at the exact doc
          // (and revision) it was chomped from — the doc itself is expected
          // to be deleted by the chomp PR.
          sourceRefs: [
            {
              type: 'doc',
              path: item.sourcePath,
              ...(input.sourceCommit ? { commit: input.sourceCommit } : {}),
            } satisfies RoadmapSourceRef,
          ],
          ...(item.tags.length > 0
            ? {
                notes: [
                  {
                    at: Date.now(),
                    by,
                    text: `chomped from ${item.sourcePath} (tags: ${item.tags.join(', ')})`,
                  },
                ],
              }
            : {}),
        };
    if (input.harbor) upsertInput.harbor = input.harbor;
    if (!input.harbor && input.project) upsertInput.project = input.project;
    roadmapItems.upsert(upsertInput);
  }

  if (!input.dryRun && graphEdges) {
    for (const edge of parentEdges) {
      graphEdges.remember(parentEdge(edge.parent, edge.child));
      parentEdgesWritten += 1;
    }
  }

  return {
    items: reports,
    inserted,
    updated,
    parentEdges,
    parentEdgesWritten,
    dangling,
    dryRun: Boolean(input.dryRun),
  };
}

// ────── Orchestrator ──────

export interface ChompRoadmapInput extends ChompCollectInput, ChompWriteInput {
  /** Optional enrichment through the daemon's real LLM path. */
  enrich?: ChompEnrichOptions;
}

export interface ChompRoadmapResult extends ChompWriteResult {
  docs: ChompDocReport[];
  missingFiles: string[];
  warnings: string[];
  enrichment: ChompEnrichment | null;
  /** Commit SHA the source docs were read at (echoed for the work receipt). */
  sourceCommit: string | null;
}

/**
 * Full chomp: read docs → extract → (optionally) enrich → write.
 *
 * This is the entry point `POST /roadmap/chomp` calls. By design it is async
 * only because enrichment is; with no `enrich` option the flow is fully
 * deterministic and synchronous underneath. Dry-run performs the read +
 * extract + resolution phases and reports the exact tree that WOULD be
 * written, without touching the table or graph_edges — the same
 * "look before you chomp" contract the legacy importer offered.
 *
 * @param deps - roadmap-items primitive plus optional graph-edges primitive.
 * @param input - Docs, harbor, agent, dry-run, and enrichment options.
 * @returns The combined per-doc, per-item, edge, and enrichment report.
 */
export async function chompRoadmap(
  deps: { roadmapItems: RoadmapItems; graphEdges?: GraphEdges },
  input: ChompRoadmapInput,
): Promise<ChompRoadmapResult> {
  const collection = collectChompDocs(input);
  let enrichment: ChompEnrichment | null = null;
  if (input.enrich && !input.dryRun) {
    enrichment = await enrichChompedItems(collection.items, input.enrich);
  }
  const written = writeChompedItems(deps.roadmapItems, deps.graphEdges, collection.items, input);
  return {
    ...written,
    docs: collection.docs,
    missingFiles: collection.missingFiles,
    warnings: collection.warnings,
    enrichment,
    sourceCommit: input.sourceCommit ?? null,
  };
}

// ────── Legacy alias: the three canonical curated piles ──────

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
  paths?: { roadmap?: string; ideasTrove?: string; dogfoodFeedback?: string };
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

const LEGACY_SOURCE_BY_INDEX: ImportSource[] = ['next-cut', 'ideas-now', 'dogfood'];
const LEGACY_FORMAT_BY_INDEX: ChompDocFormat[] = ['next-cuts-pile', 'entry-pile', 'entry-pile'];

/**
 * Parse the three curated markdown piles into a de-duplicated, ordered list
 * of import candidates — the legacy `roadmap-import` surface, now served by
 * the general chomper. Pure: no I/O beyond what the caller hands in.
 *
 * Why keep this export: existing tests and the reconcile report speak this
 * shape; keeping the function as a thin adapter over {@link chompMarkdownDoc}
 * is what "supplant, don't parallel" means in practice — one parser, the old
 * name resolving into it.
 *
 * Precedence: next-cut > ideas-now > dogfood (doc order = precedence order;
 * first writer for a slug wins, later piles still counted in `parsed`).
 *
 * @param input - Raw markdown for each pile (null when the file is absent).
 * @returns Ordered candidates plus per-pile pre-dedupe parse counts.
 */
export function collectImportCandidates(input: {
  roadmapMd: string | null;
  ideasTroveMd: string | null;
  dogfoodMd: string | null;
}): { candidates: ImportCandidate[]; parsed: ImportMarkdownResult['parsed'] } {
  const mds = [input.roadmapMd, input.ideasTroveMd, input.dogfoodMd];
  const counts = [0, 0, 0];
  const candidates: ImportCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mds.length; i += 1) {
    const md = mds[i];
    if (md === null) continue;
    const doc = chompMarkdownDoc(md, {
      sourcePath: LEGACY_SOURCE_BY_INDEX[i],
      format: LEGACY_FORMAT_BY_INDEX[i],
      tags: [],
    });
    counts[i] = doc.items.length;
    for (const item of doc.items) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      candidates.push({
        slug: item.slug,
        summaryMd: item.summaryMd,
        status: item.status,
        source: LEGACY_SOURCE_BY_INDEX[i],
      });
    }
  }
  return { candidates, parsed: { nextCuts: counts[0], ideasNow: counts[1], dogfood: counts[2] } };
}

/**
 * Backfill `roadmap_items` from the three canonical curated piles — the
 * legacy `pd roadmap import-markdown` verb, now an alias that chomps the
 * canonical paths through the general path.
 *
 * Everything the legacy importer promised still holds by design, because it
 * is the same write layer: idempotent UNIQUE(slug, harbor) upserts, re-runs bump
 * `last_touched_at` only, and rows enriched after the first import
 * (promoter, summary, status) are never clobbered. `.cartographer/config.*`
 * path overrides are honored exactly as before so the import reads the same
 * files the dashboard reads.
 *
 * @param roadmapItems - The roadmap DB-of-record primitive.
 * @param input - Root/paths/harbor/agent/dry-run options (legacy shape).
 * @returns The legacy-shaped reconcile report.
 */
export function importMarkdownRoadmap(
  roadmapItems: RoadmapItems,
  input: ImportMarkdownInput = {},
): ImportMarkdownResult {
  const root = input.rootDir ?? process.cwd();
  const cfg = loadCartographerConfig(root);
  const roadmapRel = input.paths?.roadmap ?? cfg.paths.roadmap ?? LEGACY_PATHS.roadmap;
  const ideasRel = input.paths?.ideasTrove ?? cfg.paths.ideasTrove ?? LEGACY_PATHS.ideasTrove;
  const dogfoodRel =
    input.paths?.dogfoodFeedback ?? cfg.paths.dogfoodFeedback ?? LEGACY_PATHS.dogfoodFeedback;

  /**
   * Resolve a pile path against the repo root.
   *
   * Why: legacy path overrides may be absolute (tests) or repo-relative
   * (config); the design honors both exactly as the old importer did.
   *
   * @param p - Configured pile path.
   * @returns Absolute path on disk.
   */
  const resolvePileFor = (p: string): string => (isAbsolute(p) ? p : join(root, p));
  const roadmapPath = resolvePileFor(roadmapRel);
  const ideasPath = resolvePileFor(ideasRel);
  const dogfoodPath = resolvePileFor(dogfoodRel);

  const roadmapMd = readSafe(roadmapPath);
  const ideasTroveMd = readSafe(ideasPath);
  const dogfoodMd = readSafe(dogfoodPath);

  const missingFiles: string[] = [];
  if (roadmapMd === null) missingFiles.push(roadmapPath);
  if (ideasTroveMd === null) missingFiles.push(ideasPath);
  if (dogfoodMd === null) missingFiles.push(dogfoodPath);

  const { candidates, parsed } = collectImportCandidates({ roadmapMd, ideasTroveMd, dogfoodMd });

  // Re-shape the candidates as chomped items (flat pile rows: no hierarchy,
  // no deps, no tags/notes — legacy inserts carried none) and run them
  // through the ONE write layer. sourcePath maps back to the real pile file
  // so fresh rows still gain honest `source_refs_json` provenance.
  const pathBySource: Record<ImportSource, string> = {
    'next-cut': roadmapRel,
    'ideas-now': ideasRel,
    dogfood: dogfoodRel,
  };
  const items: ChompedItem[] = candidates.map((c) => ({
    slug: c.slug,
    kind: 'task' as RoadmapKind,
    summaryMd: c.summaryMd,
    descriptionMd: null,
    status: c.status,
    parent: null,
    dependsOn: [],
    tags: [],
    sourcePath: pathBySource[c.source],
    heading: null,
    depth: 0,
  }));

  const written = writeChompedItems(roadmapItems, undefined, items, {
    harbor: input.harbor,
    project: input.project,
    by: input.by ?? 'roadmap-import',
    dryRun: input.dryRun,
  });

  return {
    candidates,
    inserted: written.inserted,
    updated: written.updated,
    parsed,
    missingFiles,
    dryRun: Boolean(input.dryRun),
  };
}
