/**
 * Semantic 3-way merge for `docs/roadmap/roadmap.snapshot.json`.
 *
 * The snapshot is a committed read-replica of the daemon's roadmap
 * (`scripts/export-roadmap-snapshot.ts`) — it has to stay committed because:
 *   - CI cannot reach a developer's local daemon/SQLite to regenerate it.
 *   - `tests/purser/test-roadmap-snapshot.js` asserts on its exact committed
 *     content (an oracle, not just a cache).
 *   - `docs/audits/tenancy-boundary.spec.json` declares it a `public`-tier
 *     feature that is deliberately committed to the repo.
 *
 * A textual diff conflicts constantly anyway: every regeneration stamps a new
 * `generatedAt`, and two branches that each add *different* new roadmap items
 * touch the same 1300-line array without touching the same lines semantically.
 * This module resolves that the way a human would — per-item, keyed by slug —
 * so the common case (two branches adding disjoint items) merges cleanly, and
 * only a genuine same-slug edit on both sides surfaces as a real conflict.
 *
 * Pure and I/O-free so it is unit-testable; `scripts/merge-roadmap-snapshot.ts`
 * wraps it as a git merge driver (`%O %A %B` on the command line).
 */

export interface SnapshotItem {
  slug: string;
  status: string;
  summaryMd?: string;
}

export interface Snapshot {
  generatedAt: number;
  harbor?: string;
  source?: string;
  count: number;
  items: SnapshotItem[];
}

/** A slug where ours and theirs disagree, and neither side just matches base. */
export interface MergeConflict {
  slug: string;
  base: SnapshotItem | null;
  ours: SnapshotItem | null;
  theirs: SnapshotItem | null;
}

export interface MergeOutcome {
  /** Best-effort merged snapshot — always valid JSON, even with conflicts left in. */
  snapshot: Snapshot;
  /** Non-empty means a human must resolve these slugs by hand. */
  conflicts: MergeConflict[];
}

function itemsEqual(a: SnapshotItem | null, b: SnapshotItem | null): boolean {
  if (!a || !b) return a === b;
  return a.slug === b.slug && a.status === b.status && (a.summaryMd ?? '') === (b.summaryMd ?? '');
}

/**
 * Merge `ours` and `theirs` against their common ancestor `base` (null if
 * unavailable — everything then reads as "both sides changed it").
 *
 * Per slug, standard 3-way resolution: unchanged-on-one-side wins; identical
 * changes on both sides collapse to one; a real divergence is reported as a
 * conflict (and `ours` is kept as the best-effort placeholder so the output
 * stays valid JSON for a human to finish resolving).
 */
export function mergeSnapshots(base: Snapshot | null, ours: Snapshot, theirs: Snapshot): MergeOutcome {
  const baseMap = new Map((base?.items ?? []).map((i) => [i.slug, i]));
  const oursMap = new Map(ours.items.map((i) => [i.slug, i]));
  const theirsMap = new Map(theirs.items.map((i) => [i.slug, i]));

  const allSlugs = new Set<string>([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);
  const merged: SnapshotItem[] = [];
  const conflicts: MergeConflict[] = [];

  for (const slug of allSlugs) {
    const b = baseMap.get(slug) ?? null;
    const o = oursMap.get(slug) ?? null;
    const t = theirsMap.get(slug) ?? null;

    if (itemsEqual(o, t)) {
      if (o) merged.push(o);
      continue;
    }

    const oursChanged = !itemsEqual(o, b);
    const theirsChanged = !itemsEqual(t, b);

    if (oursChanged && !theirsChanged) {
      if (o) merged.push(o);
      continue;
    }
    if (theirsChanged && !oursChanged) {
      if (t) merged.push(t);
      continue;
    }

    // Both sides changed this slug, and not to the same thing — real conflict.
    conflicts.push({ slug, base: b, ours: o, theirs: t });
    if (o) merged.push(o); // keep the file well-formed; caller must still fail loudly
  }

  merged.sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    snapshot: {
      generatedAt: Math.max(ours.generatedAt ?? 0, theirs.generatedAt ?? 0),
      harbor: ours.harbor ?? theirs.harbor,
      source: ours.source ?? theirs.source,
      count: merged.length,
      items: merged,
    },
    conflicts,
  };
}
