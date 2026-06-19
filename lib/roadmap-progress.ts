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
import { join, isAbsolute } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  Feedback as LiveFeedback,
  FeedbackEntry as LiveFeedbackEntry,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackStatus,
} from './feedback.js';

export interface NextCut {
  slug: string;
  summary: string;
}

export type RoadmapFeedbackStatus =
  | 'now'
  | 'backlog'
  | 'parked'
  | 'merge'
  | 'unknown'
  | FeedbackStatus;

export interface FeedbackEntry {
  slug: string;
  status: RoadmapFeedbackStatus;
  surface: string | null;
  hook: string | null;
  summary?: string | null;
  feedbackId?: string;
  severity?: FeedbackSeverity;
  source?: FeedbackSource;
  suggested?: string | null;
  droppedBy?: string | null;
  project?: string | null;
  harbor?: string | null;
  at?: number | null;
  harvestedAt?: number | null;
  harvestedIntoSlug?: string | null;
  provenance?: 'markdown' | 'tuple';
}

export interface FeedbackSummary {
  total: number;
  open: number;
  harvested: number;
  bySeverity: Record<FeedbackSeverity, number>;
  bySurface: Record<string, number>;
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
    feedbackTupleHarbor?: string | null;
    feedbackTupleStatus?: FeedbackStatus | 'all';
  };
  freshness: {
    /** Latest mtime across the four cartographer-curated files (ms epoch). */
    latestUpdateMs: number | null;
    /** Hours since latestUpdateMs — quick "is cartographer working?" signal. */
    hoursSinceLastUpdate: number | null;
  };
  nextCuts: NextCut[];
  ideasNow: FeedbackEntry[];
  liveFeedback: FeedbackEntry[];
  feedbackSummary: FeedbackSummary | null;
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

/**
 * Per-path overrides — let consumers point cartographer at non-default
 * locations without monkey-patching. Each value is resolved against
 * `rootDir` if relative, otherwise used as-is.
 */
export interface RoadmapProgressPaths {
  roadmap?: string;
  ideasTrove?: string;
  dogfoodFeedback?: string;
  currentWork?: string;
  cartographerStatus?: string;
}

export interface RoadmapProgressInput {
  /** Repository root — defaults to process.cwd(). */
  rootDir?: string;
  /** Explicit per-file overrides. Win over config file + defaults. */
  paths?: RoadmapProgressPaths;
  /** How many lines of CURRENT-WORK.md to surface. Default 60. */
  currentWorkMaxLines?: number;
  /** How many lines of .cartographer/status.md to surface. Default 60. */
  cartographerStatusMaxLines?: number;
  /** Optional live feedback primitive. When present, roadmap truth includes tuple-backed feedback. */
  feedback?: Pick<LiveFeedback, 'list' | 'summary'>;
  /** Harbor scope for tuple-backed feedback. Omit to read all harbors. */
  feedbackHarbor?: string;
  /** Feedback status to surface in liveFeedback. Default: open. */
  feedbackStatus?: FeedbackStatus | 'all';
  /** Maximum live feedback rows to surface. Default 100. */
  feedbackLimit?: number;
}

const DEFAULT_PATHS: Required<RoadmapProgressPaths> = {
  roadmap: 'docs/ROADMAP.md',
  ideasTrove: 'docs/recovery/IDEAS-TROVE.md',
  dogfoodFeedback: 'docs/recovery/DOGFOOD-FEEDBACK.md',
  currentWork: 'docs/recovery/CURRENT-WORK.md',
  cartographerStatus: '.cartographer/status.md',
};

const CONFIG_CANDIDATES = [
  '.cartographer/config.yml',
  '.cartographer/config.yaml',
  '.cartographer/config.json',
];

function resolvePath(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}

/**
 * Read `.cartographer/config.{yml,yaml,json}` if present. Recognized
 * keys (all optional): `paths.roadmap`, `paths.ideas_trove` /
 * `paths.ideasTrove`, `paths.dogfood_feedback` / `paths.dogfoodFeedback`,
 * `paths.current_work` / `paths.currentWork`, `paths.cartographer_status`
 * / `paths.cartographerStatus`. Both snake and camel keys are accepted
 * since YAML communities differ.
 */
export function loadCartographerConfig(rootDir: string): {
  paths: RoadmapProgressPaths;
  configPath: string | null;
  warning: string | null;
} {
  for (const rel of CONFIG_CANDIDATES) {
    const abs = join(rootDir, rel);
    if (!existsSync(abs)) continue;
    try {
      const raw = readFileSync(abs, 'utf-8');
      const parsed = rel.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
      const p = (parsed && typeof parsed === 'object' && (parsed as any).paths) || {};
      const paths: RoadmapProgressPaths = {
        roadmap: typeof p.roadmap === 'string' ? p.roadmap : undefined,
        ideasTrove: typeof p.ideas_trove === 'string' ? p.ideas_trove : (typeof p.ideasTrove === 'string' ? p.ideasTrove : undefined),
        dogfoodFeedback: typeof p.dogfood_feedback === 'string' ? p.dogfood_feedback : (typeof p.dogfoodFeedback === 'string' ? p.dogfoodFeedback : undefined),
        currentWork: typeof p.current_work === 'string' ? p.current_work : (typeof p.currentWork === 'string' ? p.currentWork : undefined),
        cartographerStatus: typeof p.cartographer_status === 'string' ? p.cartographer_status : (typeof p.cartographerStatus === 'string' ? p.cartographerStatus : undefined),
      };
      return { paths, configPath: abs, warning: null };
    } catch (err) {
      return {
        paths: {},
        configPath: abs,
        warning: `${rel} could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return { paths: {}, configPath: null, warning: null };
}

function mapLiveFeedback(entry: LiveFeedbackEntry): FeedbackEntry {
  return {
    slug: entry.slug,
    status: entry.status,
    surface: entry.surface,
    hook: entry.hook ?? entry.summary,
    summary: entry.summary,
    feedbackId: entry.feedbackId,
    severity: entry.severity,
    source: entry.source,
    suggested: entry.suggested,
    droppedBy: entry.droppedBy,
    project: entry.project,
    harbor: entry.harbor,
    at: entry.at,
    harvestedAt: entry.harvestedAt,
    harvestedIntoSlug: entry.harvestedIntoSlug,
    provenance: 'tuple',
  };
}

function readLiveFeedback(input: RoadmapProgressInput, warnings: string[]): {
  liveFeedback: FeedbackEntry[];
  feedbackSummary: FeedbackSummary | null;
} {
  if (!input.feedback) {
    return { liveFeedback: [], feedbackSummary: null };
  }

  try {
    const liveFeedback = input.feedback.list({
      harbor: input.feedbackHarbor,
      status: input.feedbackStatus ?? 'open',
      limit: input.feedbackLimit ?? 100,
    }).map(mapLiveFeedback);
    return {
      liveFeedback,
      feedbackSummary: input.feedback.summary(input.feedbackHarbor),
    };
  } catch (err) {
    warnings.push(`live feedback tuples could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return { liveFeedback: [], feedbackSummary: null };
  }
}

export function getRoadmapProgress(input: RoadmapProgressInput = {}): RoadmapProgress {
  const root = input.rootDir ?? process.cwd();
  const warnings: string[] = [];

  const cfg = loadCartographerConfig(root);
  if (cfg.warning) warnings.push(cfg.warning);

  const merged: Required<RoadmapProgressPaths> = {
    roadmap: input.paths?.roadmap ?? cfg.paths.roadmap ?? DEFAULT_PATHS.roadmap,
    ideasTrove: input.paths?.ideasTrove ?? cfg.paths.ideasTrove ?? DEFAULT_PATHS.ideasTrove,
    dogfoodFeedback: input.paths?.dogfoodFeedback ?? cfg.paths.dogfoodFeedback ?? DEFAULT_PATHS.dogfoodFeedback,
    currentWork: input.paths?.currentWork ?? cfg.paths.currentWork ?? DEFAULT_PATHS.currentWork,
    cartographerStatus: input.paths?.cartographerStatus ?? cfg.paths.cartographerStatus ?? DEFAULT_PATHS.cartographerStatus,
  };

  const roadmapPath = resolvePath(root, merged.roadmap);
  const ideasTrovePath = resolvePath(root, merged.ideasTrove);
  const dogfoodFeedbackPath = resolvePath(root, merged.dogfoodFeedback);
  const currentWorkPath = resolvePath(root, merged.currentWork);
  const cartographerStatusPath = resolvePath(root, merged.cartographerStatus);

  const roadmapText = readSafe(roadmapPath);
  const ideasText = readSafe(ideasTrovePath);
  const feedbackText = readSafe(dogfoodFeedbackPath);
  const currentWorkText = readSafe(currentWorkPath);
  const cartographerStatusText = readSafe(cartographerStatusPath);

  if (!roadmapText) warnings.push(`roadmap not found at ${roadmapPath}`);
  if (!ideasText) warnings.push(`ideas trove not found at ${ideasTrovePath}`);

  const nextCuts = roadmapText ? parseNextCuts(roadmapText) : [];
  const allIdeas = ideasText ? parseFeedbackEntries(ideasText) : [];
  const dogfoodFeedback = feedbackText ? parseFeedbackEntries(feedbackText) : [];
  const { liveFeedback, feedbackSummary } = readLiveFeedback(input, warnings);

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
    ...liveFeedback.flatMap((entry) => [entry.at, entry.harvestedAt]),
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
      feedbackTupleHarbor: input.feedbackHarbor ?? null,
      feedbackTupleStatus: input.feedbackStatus ?? 'open',
    },
    freshness: {
      latestUpdateMs,
      hoursSinceLastUpdate,
    },
    nextCuts,
    ideasNow: allIdeas.filter((e) => e.status === 'now'),
    liveFeedback,
    feedbackSummary,
    dogfoodFeedback,
    currentWorkExcerpt,
    cartographerStatusExcerpt,
    warnings,
  };
}
