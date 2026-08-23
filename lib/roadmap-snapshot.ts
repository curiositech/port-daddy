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
 */

import { writeFileSync, mkdirSync } from 'node:fs';
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
