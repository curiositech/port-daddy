/**
 * Git merge driver for `docs/roadmap/roadmap.snapshot.json`.
 *
 * Registered (locally, per checkout) by `scripts/setup-git-merge-driver.mjs`
 * via `.gitattributes`:
 *
 *   docs/roadmap/roadmap.snapshot.json merge=roadmap-snapshot
 *
 * Git invokes a merge driver as `driver %O %A %B` — paths to the common
 * ancestor, "ours", and "theirs" — and expects the merged result written back
 * to the %A path. Exit 0 means "resolved cleanly"; non-zero leaves the file
 * marked unmerged so a human finishes it (same as an ordinary text conflict),
 * except here the file at %A already contains a best-effort merge to start
 * from instead of `<<<<<<<` markers straddling a 1300-line JSON array.
 *
 * All the actual decision logic is in `lib/roadmap-snapshot-merge.ts` (unit
 * tested); this file is I/O only.
 *
 *   Manual smoke test:
 *     npx tsx scripts/merge-roadmap-snapshot.ts base.json ours.json theirs.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mergeSnapshots, type Snapshot } from '../lib/roadmap-snapshot-merge.js';

function loadSnapshot(path: string): Snapshot | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

function main(): void {
  const [baseArg, oursArg, theirsArg] = process.argv.slice(2);
  if (!oursArg || !theirsArg) {
    console.error('Usage: merge-roadmap-snapshot.ts <base> <ours> <theirs>  (git merge-driver ABI: %O %A %B)');
    process.exit(2);
    return;
  }

  const base = baseArg ? loadSnapshot(baseArg) : null;
  const ours = loadSnapshot(oursArg);
  const theirs = loadSnapshot(theirsArg);

  if (!ours || !theirs) {
    console.error('✗ roadmap-snapshot merge driver: one side is missing/unparseable JSON — leaving a real conflict for a human.');
    process.exit(1);
    return;
  }

  const { snapshot, conflicts } = mergeSnapshots(base, ours, theirs);
  writeFileSync(oursArg, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  if (conflicts.length > 0) {
    console.error(`✗ roadmap-snapshot merge driver: ${conflicts.length} item(s) changed differently on both sides — resolve by hand:`);
    for (const c of conflicts) console.error(`  - ${c.slug}`);
    console.error('  (A best-effort merge — "ours" for the conflicting slugs — was written; fix those entries and re-run `git add`.)');
    console.error('  Or re-run `npx tsx scripts/export-roadmap-snapshot.ts` against the daemon and commit that instead.');
    process.exit(1);
    return;
  }

  console.log(`✓ roadmap-snapshot merge driver: auto-merged ${snapshot.items.length} items cleanly (generatedAt=${snapshot.generatedAt}).`);
  process.exit(0);
}

main();
