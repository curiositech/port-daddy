/**
 * ADR Implementation Matrix — parser + transform (ADR-0043).
 *
 * The problem (ADR-0043 § Context): an ADR is a Markdown file that records a
 * decision and then goes inert — nothing tells you whether the work it implies
 * was ever built. The fix is a link, not new machinery: every ADR carries an
 * "## Implementation Matrix" table whose phases ARE rows in `roadmap_items`
 * (ADR-0033, the source of truth), created at high priority (`status: 'now'`),
 * owned by a Cartographer commitment (ADR-0023 + ADR-0041).
 *
 * This module is deliberately PURE: it parses ADR Markdown and transforms the
 * matrix into `UpsertRoadmapItemInput[]`. It does NOT touch the daemon, the DB,
 * or the network — that wiring is ADR-0044... err, ADR-0043 Phase 1 (the
 * `POST /adr/sync` route + `pd adr` CLI). Keeping it pure makes the contract
 * (ADR text → roadmap upserts) exhaustively unit-testable, which is the whole
 * point: the linkage is real code with a test, not prose.
 */

import type {
  RoadmapStatus,
  UpsertRoadmapItemInput,
} from './roadmap-items.js';

/** The five canonical roadmap statuses (mirror of lib/roadmap-items.ts). */
const ROADMAP_STATUSES: readonly RoadmapStatus[] = [
  'now',
  'backlog',
  'parked',
  'merge',
  'done',
] as const;

/** Cells that mean "no dependency" in the Depends-on column. */
const EMPTY_DEP_TOKENS = new Set(['', '—', '-', 'none', 'n/a']);

/** One parsed row of an ADR's Implementation Matrix. */
export interface AdrPhase {
  /** Phase label as written (e.g. "0", "A1", "W3"). */
  phase: string;
  /** Stable roadmap join key — the contract between ADR and `roadmap_items`. */
  slug: string;
  /** Status as written in the ADR (last-known; live status comes from the DB). */
  status: RoadmapStatus;
  /** Slugs this phase depends on (already cleaned of "—"/empty tokens). */
  dependsOn: string[];
  /** Human description of the phase. */
  description: string;
}

/** Parsed identity of an ADR. */
export interface AdrIdentity {
  /** Zero-padded number as a 4-digit string, e.g. "0043". */
  number: string;
  /** Title text after the number, e.g. "ADRs Carry a Roadmap-Linked …". */
  title: string;
}

/**
 * Parse the `# NNNN. Title` heading. Returns null if the heading is missing or
 * malformed — callers treat that as "not a real ADR / nothing to sync".
 */
export function parseAdrIdentity(markdown: string): AdrIdentity | null {
  // First ATX H1. Accept "# 43.", "# 0043.", "# 43 -", "# 0043 —".
  const m = markdown.match(/^#\s+(\d{1,4})\s*[.\-—:]?\s*(.*?)\s*$/m);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isInteger(num) || num <= 0) return null;
  return { number: String(num).padStart(4, '0'), title: (m[2] ?? '').trim() };
}

/** Coerce a matrix Status cell to a RoadmapStatus. Unknown → 'now' (high-pri). */
function normalizeStatus(raw: string): RoadmapStatus {
  const v = raw.trim().toLowerCase();
  return (ROADMAP_STATUSES as readonly string[]).includes(v)
    ? (v as RoadmapStatus)
    : 'now';
}

/** Split a Markdown table row into trimmed cells, dropping the outer pipes. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** True for the `|---|:--:|` separator row beneath a table header. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

/** Parse a Depends-on cell into a list of dependency slugs. */
function parseDeps(cell: string): string[] {
  return cell
    .split(/[,;]+/)
    .map((d) => d.trim())
    .filter((d) => !EMPTY_DEP_TOKENS.has(d.toLowerCase()));
}

/**
 * Extract the rows of the `## Implementation Matrix` table. Returns [] if the
 * section is absent (a perfectly valid ADR with no buildable work). Tolerant of
 * extra prose between the heading and the table, and of header column reordering
 * as long as the expected column names are present.
 */
export function parseImplementationMatrix(markdown: string): AdrPhase[] {
  // Strip fenced code blocks first: an ADR may SHOW an example matrix inside a
  // ```fence``` (ADR-0043 does), and we must not parse the example as the real
  // one. Replace fence interiors with blank lines to preserve line structure.
  const deFenced = markdown.replace(/^(```|~~~)[\s\S]*?^\1[ \t]*$/gm, '');

  // Isolate the section from "## Implementation Matrix" to the next "## "
  // heading (or end of file). Index-based slice — JS regex has no \Z anchor.
  const startMatch = deFenced.match(/^##\s+Implementation Matrix\s*$/m);
  if (!startMatch || startMatch.index === undefined) return [];
  const rest = deFenced.slice(startMatch.index + startMatch[0].length);
  const nextHeading = rest.search(/^##\s/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const lines = section.split('\n').map((l) => l.trimEnd());
  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 2) return [];

  const header = splitRow(tableLines[0]).map((c) => c.toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iPhase = col('phase');
  const iSlug = col('slug');
  const iStatus = col('status');
  const iDeps = col('depend');
  const iDesc = col('descrip');
  // Slug is the only non-negotiable column — it is the join key.
  if (iSlug === -1) return [];

  const phases: AdrPhase[] = [];
  const seen = new Set<string>();
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    const slug = (cells[iSlug] ?? '').trim();
    if (!slug) continue;
    if (seen.has(slug)) continue; // dedupe; first wins
    seen.add(slug);
    phases.push({
      phase: iPhase >= 0 ? (cells[iPhase] ?? '').trim() : String(phases.length),
      slug,
      status: normalizeStatus(iStatus >= 0 ? cells[iStatus] ?? '' : ''),
      dependsOn: iDeps >= 0 ? parseDeps(cells[iDeps] ?? '') : [],
      description: iDesc >= 0 ? (cells[iDesc] ?? '').trim() : '',
    });
  }
  return phases;
}

export interface AdrPhasesToRoadmapOptions {
  /** Harbor for the upserts (default left undefined → daemon default). */
  harbor?: string;
  /**
   * Force every phase to high priority regardless of the ADR's written status.
   * Per the operator directive ("ALL PHASES … high-pri"), default true. A phase
   * explicitly written `done` is still honored — you don't re-prioritize work
   * that's finished.
   */
  highPriority?: boolean;
  /** Clock injection for deterministic note timestamps in tests. */
  now?: () => number;
}

/**
 * Transform parsed ADR phases into roadmap upsert inputs. Each phase becomes one
 * `roadmap_items` row keyed on its slug, tagged with `adr:NNNN`, dependencies
 * wired phase-to-phase. This is the link that makes ADR-0043 real.
 */
export function adrPhasesToRoadmapInputs(
  adr: AdrIdentity,
  phases: AdrPhase[],
  options: AdrPhasesToRoadmapOptions = {},
): UpsertRoadmapItemInput[] {
  const highPriority = options.highPriority ?? true;
  const at = (options.now ?? Date.now)();
  return phases.map((p) => {
    // High-priority directive: push to 'now' unless the phase is already done.
    const status: RoadmapStatus =
      highPriority && p.status !== 'done' ? 'now' : p.status;
    return {
      slug: p.slug,
      summaryMd: p.description || `ADR-${adr.number} phase ${p.phase}`,
      status,
      dependencies: p.dependsOn,
      notes: [{ at, by: `adr:${adr.number}`, text: `ADR-${adr.number} phase ${p.phase}` }],
      ...(options.harbor ? { harbor: options.harbor } : {}),
    };
  });
}

/**
 * Convenience: full parse of an ADR's text into roadmap upserts. Returns
 * `{ adr: null, inputs: [] }` if the text isn't a recognizable ADR.
 */
export function adrTextToRoadmapInputs(
  markdown: string,
  options: AdrPhasesToRoadmapOptions = {},
): { adr: AdrIdentity | null; inputs: UpsertRoadmapItemInput[] } {
  const adr = parseAdrIdentity(markdown);
  if (!adr) return { adr: null, inputs: [] };
  const phases = parseImplementationMatrix(markdown);
  return { adr, inputs: adrPhasesToRoadmapInputs(adr, phases, options) };
}
