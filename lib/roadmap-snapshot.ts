/**
 * Roadmap Snapshot — build the committed read-replica of the daemon roadmap.
 *
 * Why this exists: CI runners cannot reach the local daemon's SQLite, so the
 * roadmap link gate reads a committed mirror at
 * `docs/roadmap/roadmap.snapshot.json`. The daemon stays the single writer;
 * the snapshot is a read replica. This module is the ONE implementation of
 * "fetch the roadmap and shape/guard the snapshot" — used by both
 * `scripts/export-roadmap-snapshot.ts` (the standalone exporter) and
 * `pd roadmap chomp --emit-pr-plan` (which regenerates the snapshot as one of
 * the PR-able artifacts). Extracting it here supplants the logic previously
 * inlined in the script, so the two consumers cannot drift.
 *
 * Design constraints preserved from the script:
 *   - intentionally minimal shape (slug + status + summary): a link-existence
 *     oracle, not a full export; the same JSON can later be served by the
 *     Cloudflare Relay without changing consumers.
 *   - REFUSES an empty snapshot — zero items would trip the gate as "roadmap
 *     broken" for every PR, so emptiness is an error, never a write.
 *   - REFUSES a snapshot that drops a large fraction of the previously
 *     committed slugs, when the caller supplies that prior snapshot to
 *     reconcile against. This exists because the daemon this module reads
 *     from is not guaranteed to be a strict superset of committed history —
 *     an ephemeral or parallel daemon instance, a DB restored from an older
 *     backup, or a partial-loss DB all sail past the empty-snapshot guard
 *     while still silently truncating the committed roadmap on write. The
 *     empty-snapshot guard catches "zero"; this guard catches "much smaller
 *     than what git already has," which is the same failure at a different
 *     magnitude and was previously undetected by any guard or test.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RoadmapSnapshotItem {
  slug: string;
  status: string;
  summaryMd: string;
}

export interface RoadmapSnapshot {
  /** Staleness clock the CI gate reads (ms epoch). */
  generatedAt: number;
  harbor: string;
  /** Daemon base URL the snapshot was read from. */
  source: string;
  count: number;
  items: RoadmapSnapshotItem[];
}

/**
 * Structural fetch interface — the least both `globalThis.fetch` and the
 * CLI's socket-aware `pdFetch` provide. Kept minimal on purpose so either
 * transport (and a test double) can produce the snapshot without adapters.
 */
export interface SnapshotFetch {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status?: number;
    json(): Promise<unknown>;
  }>;
}

export interface BuildRoadmapSnapshotOptions {
  /** Daemon base URL from the caller's resolver (trailing slash tolerated). */
  baseUrl: string;
  /** Harbor to snapshot. */
  harbor: string;
  /** Fetch timeout in ms. Default 10s. */
  timeoutMs?: number;
  /** Injectable fetch for tests / socket transport. Defaults to global fetch. */
  fetchImpl?: SnapshotFetch;
  /**
   * The previously committed snapshot to reconcile against, when the caller
   * has one (read it from disk before calling — this module does no I/O of
   * its own besides the fetch). Omit on a genuinely first-ever export; the
   * shrink guard is a no-op with nothing to compare against.
   */
  previousSnapshot?: Pick<RoadmapSnapshot, 'items'> | null;
  /**
   * Fraction (0-1) of previously-known slugs allowed to go missing before
   * refusing. Default 0.2 (20%) — generous enough that ordinary pruning
   * (a handful of items marked done and later deleted) doesn't false-alarm,
   * tight enough to catch "this daemon's history is a fraction of prod's."
   */
  shrinkGuardFraction?: number;
  /**
   * Explicit operator override for an intentional bulk deletion. Bypasses
   * the shrink guard entirely; never set this to work around a daemon you
   * merely haven't verified has full history.
   */
  allowShrink?: boolean;
}

/**
 * Fetch the daemon's roadmap and shape it into the committed snapshot.
 *
 * Purpose: one guarded read path for every snapshot producer. Throws (with an
 * operator-actionable message) rather than writing anything questionable —
 * unreachable daemon, malformed payload, and the zero-items case are all
 * hard errors by design, because a bad committed snapshot silently breaks
 * the roadmap-link gate for every subsequent PR.
 *
 * @param options - Daemon URL, harbor, and optional timeout/fetch injection.
 * @returns The snapshot object, slug-sorted and ready to serialize.
 */
export async function buildRoadmapSnapshot(
  options: BuildRoadmapSnapshotOptions,
): Promise<RoadmapSnapshot> {
  const base = options.baseUrl.replace(/\/$/, '');
  const doFetch: SnapshotFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const url = `${base}/roadmap/items?status=all&harbor=${encodeURIComponent(options.harbor)}`;

  let payload: { success?: boolean; items?: Array<{ slug: string; status: string; summaryMd?: string }> };
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    throw new Error(
      `Could not reach the daemon at ${base}: ${(err as Error).message}. ` +
        'Start the daemon (or set PORT_DADDY_URL) and retry.',
    );
  }

  if (!payload.success || !Array.isArray(payload.items)) {
    throw new Error(
      `Daemon returned an unexpected roadmap payload: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }

  const items: RoadmapSnapshotItem[] = payload.items
    .map((i) => ({ slug: i.slug, status: i.status, summaryMd: i.summaryMd ?? '' }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (items.length === 0) {
    throw new Error(
      'Refusing to build an EMPTY snapshot — the daemon reported zero roadmap items. ' +
        'That would trip the roadmap-link gate as "roadmap broken" for every PR.',
    );
  }

  if (options.previousSnapshot && Array.isArray(options.previousSnapshot.items) && !options.allowShrink) {
    const prevSlugs = new Set(options.previousSnapshot.items.map((i) => i.slug));
    if (prevSlugs.size > 0) {
      const newSlugs = new Set(items.map((i) => i.slug));
      const missing = [...prevSlugs].filter((slug) => !newSlugs.has(slug));
      const fraction = missing.length / prevSlugs.size;
      const guard = options.shrinkGuardFraction ?? 0.2;
      if (fraction > guard) {
        throw new Error(
          `Refusing to build a snapshot that drops ${missing.length}/${prevSlugs.size} ` +
            `(${Math.round(fraction * 100)}%) previously-known roadmap item(s) — new count ` +
            `${items.length} vs previous ${prevSlugs.size}. This usually means the daemon you're ` +
            'exporting from does not have full history (an ephemeral or parallel instance, a ' +
            'restored backup, or a partial-loss DB) — writing this snapshot would silently ' +
            `truncate the committed roadmap. First missing slug(s): ${missing.slice(0, 5).join(', ')}` +
            `${missing.length > 5 ? ', ...' : ''}. If this shrink is real and intended (a genuine ` +
            'bulk deletion), pass { allowShrink: true } / --allow-shrink.',
        );
      }
    }
  }

  return {
    generatedAt: Date.now(),
    harbor: options.harbor,
    source: base,
    count: items.length,
    items,
  };
}

/**
 * Serialize + write a snapshot to disk, creating parent directories.
 *
 * Why a helper: both consumers must produce byte-identical formatting
 * (2-space JSON + trailing newline) so a regenerated snapshot diffs cleanly
 * against the committed one instead of churning on whitespace.
 *
 * @param path - Destination file path.
 * @param snapshot - Snapshot from {@link buildRoadmapSnapshot}.
 * @returns Nothing; throws on filesystem errors.
 */
export function writeRoadmapSnapshot(path: string, snapshot: RoadmapSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Read a previously committed snapshot for the shrink guard in
 * {@link buildRoadmapSnapshot}. Returns null on any read/parse failure
 * (including "no file yet") — the guard treats that as nothing to
 * reconcile against, not an error.
 */
export function readPreviousSnapshot(path: string): Pick<RoadmapSnapshot, 'items'> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown };
    if (Array.isArray(parsed.items)) return { items: parsed.items as RoadmapSnapshot['items'] };
    return null;
  } catch {
    return null;
  }
}
