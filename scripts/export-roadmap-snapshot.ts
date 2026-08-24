/**
 * Export the daemon's roadmap into a committed snapshot CI can read.
 *
 *   npx tsx scripts/export-roadmap-snapshot.ts            # writes docs/roadmap/roadmap.snapshot.json
 *   PORT_DADDY_URL=http://127.0.0.1:9886 npx tsx scripts/export-roadmap-snapshot.ts
 *
 * Why this exists: CI runners cannot reach the local daemon's SQLite, so the
 * roadmap link gate (`scripts/check-roadmap-link.ts`) reads a committed mirror
 * instead. The daemon stays the single writer; this is a read replica. Run it
 * (and commit the result) whenever the roadmap shifts — a `pd-fleet.yml`
 * Cartographer trigger on `git:committed` is the intended automation.
 *
 * The build/guard machinery lives in `lib/roadmap-snapshot.ts` (shared with
 * `pd roadmap chomp --emit-pr-plan`); this script is the standalone CLI
 * wrapper that resolves the daemon URL and prints operator guidance.
 */
import { resolve } from 'node:path';
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';
import { buildRoadmapSnapshot, writeRoadmapSnapshot } from '../lib/roadmap-snapshot.js';

const SNAPSHOT_PATH = resolve(
  process.argv[2] ?? 'docs/roadmap/roadmap.snapshot.json',
);
const BASE = resolveDaemonUrl().replace(/\/$/, '');
const HARBOR = process.env.PD_HARBOR ?? 'port-daddy';

/**
 * CLI entry: build the snapshot from the resolved daemon and write it.
 *
 * Why a thin wrapper: the guarded build/write design lives in
 * `lib/roadmap-snapshot.ts` (shared with `pd roadmap chomp --emit-pr-plan`);
 * this script only resolves the daemon URL and prints operator guidance.
 *
 * @returns Resolves after writing, or exits 1 with actionable stderr.
 */
async function main(): Promise<void> {
  let snapshot;
  try {
    snapshot = await buildRoadmapSnapshot({ baseUrl: BASE, harbor: HARBOR });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  writeRoadmapSnapshot(SNAPSHOT_PATH, snapshot);
  console.log(`✓ Wrote ${snapshot.count} roadmap items to ${SNAPSHOT_PATH}`);
  console.log('  Commit it so CI sees the current roadmap.');
}

void main();
