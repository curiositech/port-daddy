/**
 * Semantic 3-way merge for `docs/roadmap/roadmap.snapshot.json`.
 *
 * Why this exists (the motivation/rationale for the whole module): the
 * snapshot is a committed read-replica of the daemon's roadmap
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
 *
 * Reuses `SnapshotItem`/`RoadmapSnapshot` from `lib/roadmap-link-core.ts`
 * (the roadmap-link gate's own model of this exact JSON file) instead of
 * redefining the shape here — one type per file-on-disk, so a future schema
 * change can't drift between the two consumers. `Snapshot` only adds `count`,
 * which `RoadmapSnapshot` doesn't need (the gate never reads it) but the file
 * on disk always carries.
 */
import type { SnapshotItem, RoadmapSnapshot } from './roadmap-link-core.js';

export type { SnapshotItem };

/** The on-disk snapshot shape: `RoadmapSnapshot` plus the `count` field `export-roadmap-snapshot.ts` writes (and this module keeps in sync with `items.length` on every merge). */
export interface Snapshot extends RoadmapSnapshot {
  count: number;
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

/**
 * Structural equality for one roadmap item, treating `summaryMd` presence
 * loosely (`undefined` and `''` compare equal) so a round-trip through JSON
 * (which may drop an empty-string field) never reads as a spurious diff.
 *
 * Purpose: this is the primitive every merge decision below is built on — it
 * has to agree with itself on what "unchanged" means, or the 3-way merge's
 * whole "unchanged-on-one-side wins" logic silently misfires.
 *
 * @param a one side of the comparison, or `null` if the item is absent there.
 * @param b the other side, or `null` if the item is absent there.
 * @returns `true` when both sides are `null`, or both are present with the
 *   same `slug`/`status`/`summaryMd`.
 */
function itemsEqual(a: SnapshotItem | null, b: SnapshotItem | null): boolean {
  if (!a || !b) return a === b;
  return a.slug === b.slug && a.status === b.status && (a.summaryMd ?? '') === (b.summaryMd ?? '');
}

/**
 * Merge `ours` and `theirs` against their common ancestor `base` (null if
 * unavailable — everything then reads as "both sides changed it").
 *
 * Design/rationale: per slug, this runs the same 3-way logic `git merge`
 * itself would run on a single line — unchanged-on-one-side wins, identical
 * changes on both sides collapse to one — but keyed by roadmap-item slug
 * instead of by text line, which is the whole point (see module docstring
 * for why a line-based diff conflicts on nearly every merge of this file). A
 * real divergence — both sides changed the same slug, and not to the same
 * thing — is reported as a conflict; the merged snapshot still gets a
 * non-null placeholder for that slug (`ours`, falling back to `theirs`, then
 * `base`) so the file stays valid, parseable JSON for a human to finish
 * resolving by hand, rather than silently dropping the item because one side
 * happened to delete it.
 *
 * @param base the common-ancestor snapshot, or `null` if git couldn't supply
 *   one (e.g. an unrelated-histories merge) — every slug then reads as
 *   changed by whichever side(s) have it.
 * @param ours the current branch's snapshot (git's `%A`).
 * @param theirs the incoming branch's snapshot (git's `%B`).
 * @returns the merged `Snapshot` (slug-sorted, `count` recomputed from the
 *   merged `items.length`, `generatedAt` set to `max(ours, theirs)`) plus the
 *   list of slugs that could not be resolved automatically.
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
    // Keep a non-null placeholder (prefer ours, then theirs, then base) so a
    // side that DELETED the slug doesn't make the other side's edit vanish
    // from the best-effort merge — that would make the conflict harder to
    // find and resolve, not easier.
    conflicts.push({ slug, base: b, ours: o, theirs: t });
    const placeholder = o ?? t ?? b;
    if (placeholder) merged.push(placeholder);
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
