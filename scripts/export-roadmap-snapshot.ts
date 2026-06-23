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
 * The snapshot is intentionally minimal (slug + status + summary): it is a
 * link-existence oracle, not a full roadmap export. The same JSON shape can be
 * served by the Cloudflare Relay later without changing the consumer.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';

const SNAPSHOT_PATH = resolve(
  process.argv[2] ?? 'docs/roadmap/roadmap.snapshot.json',
);
const BASE = resolveDaemonUrl().replace(/\/$/, '');
const HARBOR = process.env.PD_HARBOR ?? 'port-daddy';

interface DaemonItem {
  slug: string;
  status: string;
  summaryMd?: string;
}

async function main(): Promise<void> {
  const url = `${BASE}/roadmap/items?status=all&harbor=${encodeURIComponent(HARBOR)}`;
  let payload: { success?: boolean; items?: DaemonItem[]; count?: number };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    console.error(`✗ Could not reach the daemon at ${BASE}.`);
    console.error(`  ${(err as Error).message}`);
    console.error('  Start the daemon (or set PORT_DADDY_URL) and retry.');
    process.exit(1);
    return;
  }

  if (!payload.success || !Array.isArray(payload.items)) {
    console.error('✗ Daemon returned an unexpected roadmap payload:', JSON.stringify(payload).slice(0, 200));
    process.exit(1);
    return;
  }

  const items = payload.items
    .map((i) => ({ slug: i.slug, status: i.status, summaryMd: i.summaryMd ?? '' }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (items.length === 0) {
    console.error('✗ Refusing to write an EMPTY snapshot — the daemon reported zero roadmap items.');
    console.error('  That would trip the gate as "roadmap broken" for every PR. Aborting.');
    process.exit(1);
    return;
  }

  const snapshot = {
    // generatedAt is the staleness clock the gate reads.
    generatedAt: Date.now(),
    harbor: HARBOR,
    source: BASE,
    count: items.length,
    items,
  };

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`✓ Wrote ${items.length} roadmap items to ${SNAPSHOT_PATH}`);
  console.log('  Commit it so CI sees the current roadmap.');
}

void main();
