/**
 * Roadmap-link gate — pure classification core (no I/O).
 *
 * A PR must declare which roadmap item it advances. The declaration is a body
 * trailer:
 *
 *     Roadmap-Item: <slug>             # links to a live roadmap item
 *     Roadmap-Item: none — <reason>    # explicit opt-out (chore/docs/hotfix)
 *
 * This module is the *decision* layer: given a PR body and a committed roadmap
 * snapshot, it decides whether the declaration is valid. Snapshot freshness is
 * reported separately: a frozen daemon must not make valid PR metadata expire.
 *
 * It is deliberately I/O-free so it is trivially unit-testable. The CI script
 * (`scripts/check-roadmap-link.ts`) wraps it with GitHub plumbing (event JSON,
 * `gh` labels/comments, step summary); the snapshot is produced by
 * `scripts/export-roadmap-snapshot.ts` from the daemon's `/roadmap/items`.
 *
 * Why a committed snapshot at all: CI runners cannot reach the local daemon's
 * SQLite, so the roadmap's truth has to be mirrored into the repo. The daemon
 * stays the only *writer*; this snapshot is a read replica. The same shape can
 * later be served by the Cloudflare Relay without changing this file.
 */

/** One roadmap item as mirrored into the committed snapshot. */
export interface SnapshotItem {
  slug: string;
  status: string;
  summaryMd?: string;
}

/** The committed snapshot file shape (`docs/roadmap/roadmap.snapshot.json`). */
export interface RoadmapSnapshot {
  /** Epoch ms the snapshot was exported. Drives the staleness check. */
  generatedAt: number;
  harbor?: string;
  source?: string;
  items: SnapshotItem[];
}

export type Verdict = 'pass' | 'needs-approval' | 'broken';

export interface ClassifyOptions {
  /** Snapshots older than this carry a freshness warning. Default 21 days. */
  staleAfterDays?: number;
  /** "now" injectable for tests. Default Date.now(). */
  now?: number;
}

export interface LinkResult {
  /** Terminal verdict for the gate. */
  verdict: Verdict;
  /** Machine reason code. */
  reason:
    | 'linked'
    | 'self-spawned'
    | 'opt-out'
    | 'missing-trailer'
    | 'unknown-slug'
    | 'snapshot-missing'
    | 'snapshot-empty'
    | 'snapshot-stale';
  /** The slug parsed from the trailer, if any. */
  slug: string | null;
  /** Opt-out reason, if the trailer was `none — …`. */
  optOutReason: string | null;
  /** True when a human must approve before this can land. */
  requiresHumanApproval: boolean;
  /** True when something is wrong with the roadmap itself (be loud). */
  loud: boolean;
  /** Whether the `needs-roadmap-link` label should be present after this run. */
  labelShouldBePresent: boolean;
  /** One-line human summary. */
  headline: string;
  /** Independent evidence warning; a passing link is never a runtime-health claim. */
  snapshotWarning?: string;
}

const TRAILER_KEYS = ['roadmap-item', 'roadmap'];
const SPAWN_KEYS = ['roadmap-spawns', 'roadmap-spawn'];
const OPT_OUT_TOKEN = 'none';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pull the roadmap trailer out of a PR body. Tolerant of `:` spacing, key case,
 * and CRLF. Returns the *last* matching trailer (so an edited PR's final word
 * wins). `slug` and `optOutReason` are mutually exclusive.
 */
export function parseRoadmapTrailer(body: string | null | undefined): {
  slug: string | null;
  optOutReason: string | null;
} {
  if (!body) return { slug: null, optOutReason: null };
  let slug: string | null = null;
  let optOutReason: string | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!TRAILER_KEYS.includes(key)) continue;
    const value = m[2].trim();
    const firstWord = value.split(/[\s—–-]/)[0]?.toLowerCase();
    if (firstWord === OPT_OUT_TOKEN) {
      // `none — reason` / `none - reason` / `none: reason` / bare `none`
      const reason = value.slice(OPT_OUT_TOKEN.length).replace(/^[\s—–:-]+/, '').trim();
      optOutReason = reason || 'unspecified';
      slug = null;
    } else {
      // First token is the slug (allow a trailing "— note").
      const candidate = value.split(/[\s—–]/)[0].trim();
      slug = candidate || null;
      optOutReason = null;
    }
  }
  return { slug, optOutReason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning-doc spawn rule
//
// A planning document (an ADR, a PLAN/ROADMAP file, a docs/ proposal/RFC) exists
// to *generate downstream work*. Merely linking it to one roadmap item is not
// enough — the gate also asks it to enumerate the items it spawns, via a trailer:
//
//     Roadmap-Spawns: slug-a, slug-b, slug-c
//     Roadmap-Spawns: none — <reason>     (e.g. supersedes-only, no new work)
//
// Detection is by FILE PATH (structured), never by reading prose — so it cannot
// suffer the recall problems of content keyword-matching.
// ─────────────────────────────────────────────────────────────────────────────

/** True when a changed path is a planning document that should spawn work. */
export function isPlanningDoc(path: string): boolean {
  const p = path.replace(/^\.\//, '');
  return (
    /^docs\/adr\/\d{3,4}[-.].*\.md$/i.test(p) || // a numbered ADR
    /^(PLAN|ROADMAP|[A-Z0-9]+-(ROADMAP|PLAN|DAG))\.md$/.test(p) || // top-level plans
    /^docs\/.*\b(plan|roadmap|proposal|rfc)\b[^/]*\.md$/i.test(p) // docs/ proposals
  );
}

/** The planning docs among a PR's changed files. */
export function planningDocsIn(changedFiles: string[] | null | undefined): string[] {
  return (changedFiles ?? []).filter(isPlanningDoc);
}

/** Parse the `Roadmap-Spawns:` trailer into slugs (or an opt-out reason). */
export function parseSpawns(body: string | null | undefined): {
  slugs: string[];
  optOutReason: string | null;
} {
  if (!body) return { slugs: [], optOutReason: null };
  let slugs: string[] = [];
  let optOutReason: string | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const m = rawLine.trim().match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    if (!SPAWN_KEYS.includes(m[1].toLowerCase())) continue;
    const value = m[2].trim();
    if (value.split(/[\s—–:-]/)[0]?.toLowerCase() === OPT_OUT_TOKEN) {
      optOutReason = value.slice(OPT_OUT_TOKEN.length).replace(/^[\s—–:-]+/, '').trim() || 'unspecified';
      slugs = [];
    } else {
      slugs = value
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      optOutReason = null;
    }
  }
  return { slugs, optOutReason };
}

export interface SpawnResult {
  /** Whether the PR touches any planning doc (rule only applies if so). */
  isPlanning: boolean;
  planningFiles: string[];
  verdict: Verdict;
  reason: 'not-planning' | 'spawns-declared' | 'spawn-opt-out' | 'missing-spawns';
  spawnedSlugs: string[];
  requiresHumanApproval: boolean;
  labelShouldBePresent: boolean;
  headline: string;
}

/**
 * Planning-doc spawn check. If a PR adds/edits a planning doc, it must declare
 * the downstream roadmap items it spawns (or opt out with a reason).
 */
export function classifyPlanningSpawn(
  body: string | null | undefined,
  changedFiles: string[] | null | undefined,
): SpawnResult {
  const planningFiles = planningDocsIn(changedFiles);
  if (planningFiles.length === 0) {
    return {
      isPlanning: false,
      planningFiles: [],
      verdict: 'pass',
      reason: 'not-planning',
      spawnedSlugs: [],
      requiresHumanApproval: false,
      labelShouldBePresent: false,
      headline: 'Not a planning-doc PR — spawn rule does not apply.',
    };
  }
  const { slugs, optOutReason } = parseSpawns(body);
  if (optOutReason) {
    return {
      isPlanning: true,
      planningFiles,
      verdict: 'pass',
      reason: 'spawn-opt-out',
      spawnedSlugs: [],
      requiresHumanApproval: false,
      labelShouldBePresent: false,
      headline: `Planning doc with no new work declared — ${optOutReason}.`,
    };
  }
  if (slugs.length > 0) {
    return {
      isPlanning: true,
      planningFiles,
      verdict: 'pass',
      reason: 'spawns-declared',
      spawnedSlugs: slugs,
      requiresHumanApproval: false,
      labelShouldBePresent: false,
      headline: `Planning doc spawns ${slugs.length} roadmap item(s): ${slugs.join(', ')}.`,
    };
  }
  return {
    isPlanning: true,
    planningFiles,
    verdict: 'needs-approval',
    reason: 'missing-spawns',
    spawnedSlugs: [],
    requiresHumanApproval: true,
    labelShouldBePresent: true,
    headline: `This PR changes a planning doc (${planningFiles
      .map((f) => f.split('/').pop())
      .join(', ')}) but declares no downstream roadmap items.`,
  };
}

/** A snapshot is broken when absent, malformed, or carries no items. */
export function snapshotBrokenReason(
  snapshot: RoadmapSnapshot | null,
): 'snapshot-missing' | 'snapshot-empty' | null {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) {
    return 'snapshot-missing';
  }
  if (snapshot.items.length === 0) return 'snapshot-empty';
  if (snapshot.items.some((item) => !item || typeof item.slug !== 'string' || !item.slug.trim())) {
    return 'snapshot-missing';
  }
  return null;
}

/**
 * Classify a PR against the roadmap snapshot. Pure: no labels, no comments, no
 * network — just the verdict the CI wrapper acts on.
 */
export function classify(
  body: string | null | undefined,
  snapshot: RoadmapSnapshot | null,
  opts: ClassifyOptions = {},
): LinkResult {
  const now = opts.now ?? Date.now();
  const staleAfterDays = opts.staleAfterDays ?? 21;
  const { slug, optOutReason } = parseRoadmapTrailer(body);
  const broken = snapshotBrokenReason(snapshot);
  const ageDays = snapshot ? (now - snapshot.generatedAt) / DAY_MS : NaN;
  const stale = !Number.isFinite(ageDays) || ageDays < 0 || ageDays > staleAfterDays;
  const snapshotWarning = broken
    ? 'Snapshot unavailable or empty; daemon state is unknown. Keep an operator-halted daemon stopped.'
    : stale
      ? 'Snapshot freshness is unverified; links establish recorded intent, not current daemon status. Do not restart a halted daemon to refresh it.'
      : undefined;

  // These declarations have their own evidence in the reviewed PR body and do
  // not require a daemon snapshot. No fake export timestamp or runtime write.
  if (optOutReason) {
    return {
      verdict: 'pass', reason: 'opt-out', slug: null, optOutReason,
      requiresHumanApproval: false, loud: false, labelShouldBePresent: false,
      headline: `Opt-out accepted: ${optOutReason}`, snapshotWarning,
    };
  }
  const item = !broken ? snapshot?.items.find((i) => i.slug === slug) : undefined;
  if (slug && !item && parseSpawns(body).slugs.includes(slug)) {
    return {
      verdict: 'pass', reason: 'self-spawned', slug, optOutReason: null,
      requiresHumanApproval: false, loud: false, labelShouldBePresent: false,
      headline: `Linked to \`${slug}\`, introduced by this PR's Roadmap-Spawns declaration; no daemon item creation is implied.`,
      snapshotWarning,
    };
  }

  // Existing-item links still fail closed when their evidence is unavailable.
  if (broken) {
    return {
      verdict: 'broken',
      reason: broken,
      slug,
      optOutReason,
      requiresHumanApproval: true,
      loud: true,
      labelShouldBePresent: true,
      headline:
        broken === 'snapshot-missing'
          ? 'Roadmap snapshot is missing or unreadable — the gate cannot verify links.'
          : 'Roadmap snapshot has zero items — the roadmap export is broken.',
    };
  }

  // 3. No trailer at all → must be linked or explicitly opted out.
  if (!slug) {
    return {
      verdict: 'needs-approval',
      reason: 'missing-trailer',
      slug: null,
      optOutReason: null,
      requiresHumanApproval: true,
      loud: false,
      labelShouldBePresent: true,
      headline: 'No `Roadmap-Item:` trailer — link a roadmap item or opt out explicitly.',
    };
  }

  // 4. Trailer present — does the slug exist?
  if (!item) {
    return {
      verdict: stale ? 'broken' : 'needs-approval',
      reason: stale ? 'snapshot-stale' : 'unknown-slug',
      slug,
      optOutReason: null,
      requiresHumanApproval: true,
      loud: stale,
      labelShouldBePresent: true,
      snapshotWarning,
      headline: stale
        ? `Slug "${slug}" is absent from the frozen snapshot. Correct the link, or declare genuinely new work with Roadmap-Spawns.`
        : `Slug "${slug}" is not a known roadmap item — declare new work or fix the typo.`,
    };
  }

  // Recorded membership survives a halt. Do not present the old status as live.
  return {
    verdict: 'pass',
    reason: 'linked',
    slug,
    optOutReason: null,
    requiresHumanApproval: false,
    loud: false,
    labelShouldBePresent: false,
    headline: `Linked to recorded roadmap item "${slug}"; this check does not attest runtime state.`,
    snapshotWarning,
  };
}
