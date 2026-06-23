/**
 * roadmap-link — link a PR to a roadmap item, creating the item if needed.
 *
 *   npx tsx scripts/roadmap-link.ts 512                     # infer slug from PR, create + stamp
 *   npx tsx scripts/roadmap-link.ts 512 --slug my-feature   # use/create an explicit slug
 *   npx tsx scripts/roadmap-link.ts 512 --none "docs only"  # stamp an explicit opt-out
 *
 * This is the WRITE half of the roadmap-link gate, and it runs LOCALLY because
 * the roadmap lives in the daemon's SQLite — CI cannot reach it. It:
 *   1. reads the PR (title/body/branch) via `gh`,
 *   2. ensures a roadmap item exists (POST /roadmap/items — real task creation),
 *   3. stamps `Roadmap-Item: <slug>` into the PR body via `gh pr edit`.
 *
 * After this, the CI gate (`scripts/check-roadmap-link.ts`) passes. Re-run
 * `scripts/export-roadmap-snapshot.ts` and commit so CI sees the new item.
 */
import { execFileSync } from 'node:child_process';

const BASE = (process.env.PORT_DADDY_URL ?? 'http://127.0.0.1:9876').replace(/\/$/, '');
const HARBOR = process.env.PD_HARBOR ?? 'port-daddy';

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

async function main(): Promise<void> {
  const prNum = process.argv.find((a) => /^\d+$/.test(a));
  if (!prNum) {
    console.error('Usage: npx tsx scripts/roadmap-link.ts <pr-number> [--slug s] [--none "reason"]');
    process.exit(2);
  }

  const pr = JSON.parse(gh(['pr', 'view', prNum, '--json', 'number,title,body,headRefName'])) as {
    number: number;
    title: string;
    body: string;
    headRefName: string;
  };

  const optOut = arg('--none');
  if (optOut !== null) {
    stampBody(pr, `Roadmap-Item: none — ${optOut || 'unspecified'}`);
    console.log(`✓ Stamped PR #${pr.number} with an explicit opt-out.`);
    return;
  }

  const slug = arg('--slug') || slugify(pr.headRefName || pr.title);
  if (!slug) {
    console.error('✗ Could not derive a slug — pass --slug <slug>.');
    process.exit(1);
  }

  // Does it already exist?
  let exists = false;
  try {
    const res = await fetch(`${BASE}/roadmap/items/${encodeURIComponent(slug)}?harbor=${HARBOR}`, {
      signal: AbortSignal.timeout(8000),
    });
    exists = res.ok;
  } catch {
    console.error(`✗ Daemon unreachable at ${BASE}. Start it or set PORT_DADDY_URL.`);
    process.exit(1);
  }

  if (!exists) {
    const summaryMd = pr.title?.trim() || `Work tracked by PR #${pr.number}`;
    const res = await fetch(`${BASE}/roadmap/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, summaryMd, status: 'backlog', harbor: HARBOR }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 201) {
      console.error(`✗ Failed to create roadmap item (HTTP ${res.status}): ${await res.text()}`);
      process.exit(1);
    }
    console.log(`✓ Created roadmap item "${slug}" (status: backlog).`);
  } else {
    console.log(`• Roadmap item "${slug}" already exists — linking.`);
  }

  stampBody(pr, `Roadmap-Item: ${slug}`);
  console.log(`✓ Stamped PR #${pr.number} → ${slug}`);
  console.log('  Next: `npx tsx scripts/export-roadmap-snapshot.ts` and commit so CI sees it.');
}

/** Replace any existing Roadmap-Item trailer, else append one. */
function stampBody(pr: { number: number; body: string }, trailer: string): void {
  const body = pr.body ?? '';
  const hasTrailer = /^roadmap(-item)?\s*:/im.test(body);
  const next = hasTrailer
    ? body.replace(/^roadmap(-item)?\s*:.*$/gim, trailer)
    : `${body.trimEnd()}\n\n${trailer}\n`;
  execFileSync('gh', ['pr', 'edit', String(pr.number), '--body', next], { stdio: 'inherit' });
}

void main();
