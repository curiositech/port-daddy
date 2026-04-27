/**
 * Roadmap Progress — structured read of cartographer's curated surfaces.
 *
 * The FOMO problem: ideas land in IDEAS-TROVE.md / DOGFOOD-FEEDBACK.md /
 * ROADMAP.md "Next Cuts" / CURRENT-WORK.md and feel buried because they
 * live in four files that nobody opens at once. Cartographer maintains
 * all of them; this module turns them into one structured payload so a
 * dashboard panel (or `pd roadmap`, or FleetBar) can show the operator
 * everything pending in a single glance.
 *
 * Authority: this module *reads*. Cartographer (the fleet agent) is the
 * only writer. We never mutate roadmap files from here.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface NextCut {
  slug: string;
  summary: string;
}

export interface FeedbackEntry {
  slug: string;
  status: 'now' | 'backlog' | 'parked' | 'merge' | 'unknown';
  surface: string | null;
  hook: string | null;
}

export interface RecentCommit {
  sha: string;
  subject: string;
}

export interface RoadmapProgress {
  generatedAt: number;
  sources: {
    roadmapPath: string;
    ideasTrovePath: string;
    dogfoodFeedbackPath: string;
    currentWorkPath: string;
    cartographerStatusPath: string;
  };
  freshness: {
    /** Latest mtime across the four cartographer-curated files (ms epoch). */
    latestUpdateMs: number | null;
    /** Hours since latestUpdateMs — quick "is cartographer working?" signal. */
    hoursSinceLastUpdate: number | null;
  };
  nextCuts: NextCut[];
  ideasNow: FeedbackEntry[];
  dogfoodFeedback: FeedbackEntry[];
  currentWorkExcerpt: string | null;
  cartographerStatusExcerpt: string | null;
  warnings: string[];
}

function readSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function safeMtime(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Pull the bullets under ROADMAP.md "Next Cuts (From Curated Trove)". Each
 * bullet is a `**slug** — summary` pair we surface as a structured row.
 */
export function parseNextCuts(roadmapMarkdown: string): NextCut[] {
  const startIdx = roadmapMarkdown.indexOf('## Next Cuts');
  if (startIdx === -1) return [];
  const after = roadmapMarkdown.slice(startIdx);
  const nextHeader = after.indexOf('\n## ', 3);
  const block = nextHeader === -1 ? after : after.slice(0, nextHeader);

  const cuts: NextCut[] = [];
  let current: { slug: string; summaryParts: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    cuts.push({
      slug: current.slug,
      summary: current.summaryParts.join(' ').replace(/\s+/g, ' ').trim(),
    });
  };
  const lineRe = /^- \*\*`?([^`*]+)`?\*\*\s+—\s+(.+)$/;
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    const m = trimmed.match(lineRe);
    if (m) {
      flush();
      current = { slug: m[1].trim(), summaryParts: [m[2].trim()] };
      continue;
    }
    if (current && line.startsWith('  ') && trimmed.length > 0) {
      current.summaryParts.push(trimmed);
    }
  }
  flush();
  return cuts;
}

/**
 * Pull `### \`slug\`` entries from IDEAS-TROVE.md or DOGFOOD-FEEDBACK.md.
 * We keep status (`now` / `backlog` / etc.) and the first surface/why hook
 * so the dashboard can render one row per entry without server round-trips.
 */
export function parseFeedbackEntries(markdown: string): FeedbackEntry[] {
  const entries: FeedbackEntry[] = [];
  const sectionRe = /^###\s+`([^`]+)`\s*$/m;
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(sectionRe);
    if (!m) { i++; continue; }
    const slug = m[1];
    let status: FeedbackEntry['status'] = 'unknown';
    let surface: string | null = null;
    let hook: string | null = null;

    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('### ') && !lines[j].startsWith('## ')) {
      const line = lines[j].trim();
      const statusMatch = line.match(/^-\s+status:\s+`?(\w+)`?/i);
      if (statusMatch) {
        const v = statusMatch[1].toLowerCase();
        if (v === 'now' || v === 'backlog' || v === 'parked' || v === 'merge') {
          status = v;
        }
      }
      const surfaceMatch = line.match(/^-\s+surface:\s+(.+)$/i);
      if (surfaceMatch && !surface) {
        surface = surfaceMatch[1].trim();
        j++;
        continue;
      }
      if (statusMatch) {
        j++;
        continue;
      }
      // First non-status sub-bullet gives a useful one-liner hook.
      if (!hook && /^\s+-\s+/.test(lines[j])) {
        const candidate = lines[j].trim().replace(/^-\s+/, '');
        if (!/^(why it matters|next cut|provenance):$/i.test(candidate)) {
          hook = candidate;
        }
      }
      j++;
    }

    entries.push({ slug, status, surface, hook });
    i = j;
  }
  return entries;
}

function trimToMaxLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n…';
}

export interface RoadmapProgressInput {
  /** Repository root — defaults to process.cwd(). */
  rootDir?: string;
  /** How many lines of CURRENT-WORK.md to surface. Default 60. */
  currentWorkMaxLines?: number;
  /** How many lines of .cartographer/status.md to surface. Default 60. */
  cartographerStatusMaxLines?: number;
}

export function getRoadmapProgress(input: RoadmapProgressInput = {}): RoadmapProgress {
  const root = input.rootDir ?? process.cwd();
  const roadmapPath = join(root, 'docs/ROADMAP.md');
  const ideasTrovePath = join(root, 'docs/recovery/IDEAS-TROVE.md');
  const dogfoodFeedbackPath = join(root, 'docs/recovery/DOGFOOD-FEEDBACK.md');
  const currentWorkPath = join(root, 'docs/recovery/CURRENT-WORK.md');
  const cartographerStatusPath = join(root, '.cartographer/status.md');

  const warnings: string[] = [];
  const roadmapText = readSafe(roadmapPath);
  const ideasText = readSafe(ideasTrovePath);
  const feedbackText = readSafe(dogfoodFeedbackPath);
  const currentWorkText = readSafe(currentWorkPath);
  const cartographerStatusText = readSafe(cartographerStatusPath);

  if (!roadmapText) warnings.push(`docs/ROADMAP.md not found at ${roadmapPath}`);
  if (!ideasText) warnings.push(`docs/recovery/IDEAS-TROVE.md not found at ${ideasTrovePath}`);

  const nextCuts = roadmapText ? parseNextCuts(roadmapText) : [];
  const allIdeas = ideasText ? parseFeedbackEntries(ideasText) : [];
  const dogfoodFeedback = feedbackText ? parseFeedbackEntries(feedbackText) : [];

  const currentWorkExcerpt = currentWorkText
    ? trimToMaxLines(currentWorkText, input.currentWorkMaxLines ?? 60)
    : null;
  const cartographerStatusExcerpt = cartographerStatusText
    ? trimToMaxLines(cartographerStatusText, input.cartographerStatusMaxLines ?? 60)
    : null;

  const mtimes = [
    safeMtime(roadmapPath),
    safeMtime(ideasTrovePath),
    safeMtime(dogfoodFeedbackPath),
    safeMtime(currentWorkPath),
    safeMtime(cartographerStatusPath),
  ].filter((v): v is number => typeof v === 'number');
  const latestUpdateMs = mtimes.length > 0 ? Math.max(...mtimes) : null;
  const hoursSinceLastUpdate =
    latestUpdateMs === null ? null : Math.round(((Date.now() - latestUpdateMs) / 3_600_000) * 10) / 10;

  return {
    generatedAt: Date.now(),
    sources: {
      roadmapPath,
      ideasTrovePath,
      dogfoodFeedbackPath,
      currentWorkPath,
      cartographerStatusPath,
    },
    freshness: {
      latestUpdateMs,
      hoursSinceLastUpdate,
    },
    nextCuts,
    ideasNow: allIdeas.filter((e) => e.status === 'now'),
    dogfoodFeedback,
    currentWorkExcerpt,
    cartographerStatusExcerpt,
    warnings,
  };
}
