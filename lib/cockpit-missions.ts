/**
 * Cockpit Missions — Roadmap Intake
 *
 * First slice of the App-Native Development Cockpit. Reads a project's
 * roadmap/recovery markdown into typed MissionCard records the cockpit UI
 * can render as a work queue.
 *
 * Sources, in order of authority:
 *   1. docs/recovery/CURRENT-WORK.md            — in-flight ledger
 *   2. docs/recovery/UNIFIED-ROADMAP.md         — release-cut + tracks
 *   3. .cartographer/status.md                  — closeness + blocked snapshot
 *
 * Parsing is intentionally narrow: structured markdown headings only.
 * Status comes from explicit suffix tags the docs already use
 * (`(CLOSED)`, `(BLOCKED ...)`, `(DRIFTING ...)`, `(MOSTLY RESOLVED)`,
 * `(MOSTLY COMMITTED ...)`, `(UNCOMMITTED ...)`, `(STALLED ...)`).
 * No free-text classification. Missing tag → status = 'unknown'.
 *
 * Cards include first-paragraph summary, bullet evidence, and any
 * backtick-quoted paths or markdown links as `files`. Owners, claims, and
 * skill graft are out of scope for this slice — the cockpit can later
 * cross-reference those from /sessions, /operator/file-claims, and the
 * skill index.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export type MissionStatus =
  | 'closed'
  | 'blocked'
  | 'drifting'
  | 'stalled'
  | 'mostly-resolved'
  | 'mostly-committed'
  | 'uncommitted'
  | 'in-flight'
  | 'unknown';

export interface MissionCard {
  id: string;
  title: string;
  status: MissionStatus;
  source: string;
  sourceAnchor: string;
  summary: string;
  evidence: string[];
  files: string[];
  updatedAt: number;
}

interface SourceSpec {
  /** Path relative to projectDir. */
  relPath: string;
  /** Heading levels to treat as mission headings (1, 2, 3...). */
  levels: ReadonlyArray<number>;
  /** Section heading (H2) whose children should be tagged as `blocked`. */
  blockedSection?: string;
}

const DEFAULT_SOURCES: ReadonlyArray<SourceSpec> = [
  { relPath: 'docs/recovery/CURRENT-WORK.md', levels: [3] },
  { relPath: 'docs/recovery/UNIFIED-ROADMAP.md', levels: [2, 3] },
  {
    relPath: '.cartographer/status.md',
    levels: [3],
    blockedSection: 'Top 3 Blocked or Drifting',
  },
];

const STATUS_TAG_PATTERN = /\(([^)]+)\)\s*$/;
const BACKTICK_PATH_PATTERN = /`([^`\n]+)`/g;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const PATH_LIKE = /^[\w./@\-]+\.[a-zA-Z0-9]{1,8}$/;

function statusFromHeading(heading: string): MissionStatus {
  const m = heading.match(STATUS_TAG_PATTERN);
  if (!m) return 'unknown';
  const tag = m[1].trim().toLowerCase();
  if (tag.startsWith('closed')) return 'closed';
  if (tag.startsWith('blocked')) return 'blocked';
  if (tag.startsWith('drifting')) return 'drifting';
  if (tag.startsWith('stalled')) return 'stalled';
  if (tag.startsWith('mostly resolved')) return 'mostly-resolved';
  if (tag.startsWith('mostly committed')) return 'mostly-committed';
  if (tag.startsWith('uncommitted')) return 'uncommitted';
  if (tag.startsWith('criteria mostly met')) return 'mostly-committed';
  if (tag.startsWith('in flight') || tag.startsWith('in-flight')) return 'in-flight';
  return 'unknown';
}

function stripStatusTag(heading: string): string {
  // Only strip the trailing (...) suffix when it actually maps to a known
  // status — otherwise it's an inline reference like `Phase 1 (1A)` and
  // belongs in the slug + title.
  if (statusFromHeading(heading) === 'unknown') return heading.trim();
  return heading.replace(STATUS_TAG_PATTERN, '').trim();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extractFiles(lines: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_PATH_PATTERN.exec(line)) !== null) {
      const cand = m[1].trim();
      if (PATH_LIKE.test(cand)) out.add(cand);
    }
    BACKTICK_PATH_PATTERN.lastIndex = 0;
    while ((m = MARKDOWN_LINK_PATTERN.exec(line)) !== null) {
      const cand = m[1].trim();
      if (!cand.startsWith('http') && !cand.startsWith('#')) out.add(cand);
    }
    MARKDOWN_LINK_PATTERN.lastIndex = 0;
  }
  return Array.from(out);
}

interface RawSection {
  heading: string;
  level: number;
  body: string[];
  parentH2: string | null;
}

function splitSections(content: string): RawSection[] {
  const lines = content.split('\n');
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let lastH2: string | null = null;

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      const level = m[1].length;
      const heading = m[2].trim();
      if (level === 2) lastH2 = heading;
      current = { heading, level, body: [], parentH2: lastH2 };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function buildSummary(body: ReadonlyArray<string>): { summary: string; evidence: string[] } {
  const trimmed = body.map((l) => l.trim()).filter((l) => l.length > 0);
  const firstPara: string[] = [];
  const evidence: string[] = [];

  for (const line of trimmed) {
    if (line.startsWith('-') || line.startsWith('*')) {
      evidence.push(line.replace(/^[-*]\s*/, ''));
      if (evidence.length >= 6) break;
      continue;
    }
    if (evidence.length === 0 && firstPara.length < 3) firstPara.push(line);
  }

  return {
    summary: firstPara.join(' ').slice(0, 600),
    evidence: evidence.slice(0, 6),
  };
}

function readSourceCards(
  projectDir: string,
  spec: SourceSpec,
  taken: Set<string>,
): MissionCard[] {
  const abs = isAbsolute(spec.relPath) ? spec.relPath : join(projectDir, spec.relPath);
  let content: string;
  let mtime: number;
  try {
    content = readFileSync(abs, 'utf-8');
    mtime = statSync(abs).mtimeMs;
  } catch {
    return [];
  }

  const sections = splitSections(content);
  const cards: MissionCard[] = [];

  for (const sec of sections) {
    if (!spec.levels.includes(sec.level)) continue;
    const cleanHeading = stripStatusTag(sec.heading);
    if (!cleanHeading) continue;
    const id = slugify(cleanHeading);
    if (!id || taken.has(id)) continue;

    let status = statusFromHeading(sec.heading);
    if (status === 'unknown' && spec.blockedSection && sec.parentH2 === spec.blockedSection) {
      status = 'blocked';
    }

    const { summary, evidence } = buildSummary(sec.body);
    if (!summary && evidence.length === 0) continue;

    const files = extractFiles([cleanHeading, ...sec.body]);
    const sourceAnchor = `#${id}`;

    cards.push({
      id,
      title: cleanHeading,
      status,
      source: spec.relPath,
      sourceAnchor,
      summary,
      evidence,
      files,
      updatedAt: mtime,
    });
    taken.add(id);
  }

  return cards;
}

export interface ReadMissionsOptions {
  projectDir: string;
  sources?: ReadonlyArray<SourceSpec>;
  status?: ReadonlyArray<MissionStatus>;
  limit?: number;
}

export interface MissionIntake {
  projectDir: string;
  sources: string[];
  missing: string[];
  /**
   * Source files that exist on disk but produced zero mission cards.
   * Distinct from `missing` (which lists absent files). A source lands
   * here when the file is present but has no headings at the configured
   * level, or no recognized status tags — the common failure mode for a
   * freshly initialised roadmap that the user hasn't tagged yet.
   */
  sourcesWithNoCards: string[];
  missions: MissionCard[];
  generatedAt: number;
}

export function readMissions(options: ReadMissionsOptions): MissionIntake {
  const projectDir = options.projectDir;
  const sources = options.sources ?? DEFAULT_SOURCES;
  const taken = new Set<string>();
  const all: MissionCard[] = [];
  const missing: string[] = [];
  const sourcesWithNoCards: string[] = [];

  for (const spec of sources) {
    const cards = readSourceCards(projectDir, spec, taken);
    if (cards.length === 0) {
      const abs = isAbsolute(spec.relPath) ? spec.relPath : join(projectDir, spec.relPath);
      try {
        statSync(abs);
        sourcesWithNoCards.push(spec.relPath);
      } catch {
        missing.push(spec.relPath);
      }
      continue;
    }
    all.push(...cards);
  }

  let filtered = all;
  if (options.status && options.status.length > 0) {
    const allow = new Set(options.status);
    filtered = filtered.filter((c) => allow.has(c.status));
  }
  if (typeof options.limit === 'number' && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return {
    projectDir,
    sources: sources.map((s) => s.relPath),
    missing,
    sourcesWithNoCards,
    missions: filtered,
    generatedAt: Date.now(),
  };
}
