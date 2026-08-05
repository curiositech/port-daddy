/**
 * planner-board-gen — dry-run the roadmap → planner migration and render the browsable board.
 *
 * Reads the live roadmap from the daemon, derives the Jira hierarchy (lib/planner-migrate),
 * computes the critical-path schedule (lib/planner-schedule, the kernel's TS parity twin), and
 * writes a self-contained live HTML board (lib/planner-board). It MUTATES NOTHING — this is the
 * dry-run preview the operator reviews before `pd roadmap migrate-planner --apply` writes edges.
 *
 *   PD_BASE  daemon base URL (default: selected daemon discovery)
 *   OUT      output html path (default ./planner-board.html)
 *
 * Run: node_modules/.bin/tsx scripts/planner-board-gen.ts
 */

import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { derivePlan, planSummary, type MigrationItem } from '../lib/planner-migrate.js';
import { schedule } from '../lib/planner-schedule.js';
import { renderBoard, type AdrMeta } from '../lib/planner-board.js';
import { parseAdrIdentity } from '../lib/adr-matrix.js';
import { renderMarkdown } from '../lib/mini-markdown.js';
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';

const base = process.env.PD_BASE ?? resolveDaemonUrl();
const out = process.env.OUT ?? 'planner-board.html';

const res = await fetch(`${base}/roadmap/items?status=all&limit=2000`);
if (!res.ok) throw new Error(`GET /roadmap/items → ${res.status}`);
const body = (await res.json()) as Record<string, unknown>;
const raw = (Array.isArray(body) ? body : (body.items ?? body.data ?? [])) as Array<Record<string, unknown>>;

const items: MigrationItem[] = raw.map((i) => ({
  slug: String(i.slug),
  summaryMd: String(i.summaryMd ?? i.summary_md ?? ''),
  status: (i.status ?? 'backlog') as MigrationItem['status'],
  dependencies: (i.dependencies as string[]) ?? [],
  notes: ((i.notes as Array<{ text: string }>) ?? []).map((n) => ({ text: String(n.text ?? '') })),
  harbor: String(i.harbor ?? 'fleet'),
}));

const plan = derivePlan(items);
const summary = planSummary(plan);

// Schedule over the dependency DAG. Uniform unit estimates (existing items carry none yet), so
// the critical path is the longest dependency chain — a true preview of build ordering.
const nodes = plan.tasks.map((t) => ({ id: t.slug!, estimate: 1 }));
const sched = schedule(nodes, plan.dependsOnEdges);

// Load each ADR for the English epic name + inline reading.
const ADR_DIR = 'docs/adr';
const adrFiles = readdirSync(ADR_DIR).filter((f) => f.endsWith('.md'));
const adrs: Record<string, AdrMeta> = {};
for (const epic of plan.epics) {
  if (!epic.id.startsWith('adr-')) continue;
  const num = epic.id.replace('adr-', '');
  const file = adrFiles.find((f) => f.startsWith(`${num}-`));
  if (!file) {
    adrs[num] = {}; // ADR file not in this worktree (e.g. lives on another branch)
    continue;
  }
  const md = readFileSync(`${ADR_DIR}/${file}`, 'utf8');
  adrs[num] = {
    title: parseAdrIdentity(md)?.title,
    html: renderMarkdown(md),
    path: `${ADR_DIR}/${file}`,
  };
}

const html = renderBoard({ plan, schedule: sched, items, generatedAt: Date.now(), pdBase: base, adrs });
writeFileSync(out, html, 'utf8');

console.log('── PD Planner dry-run (NOTHING mutated) ──');
console.log(`items read:        ${items.length}`);
console.log(`epics (ADR + unsorted): ${summary.epics}`);
console.log(`tasks:             ${summary.tasks}`);
console.log(`depends_on edges:  ${summary.dependsOnEdges}`);
console.log(`critical path:     ${sched.criticalPath.length} deep (cyclic=${sched.cyclic})`);
console.log(`flags → duplicates ${summary.duplicates}, harbors ${summary.harbors}, unsorted ${summary.loose}, dangling ${plan.flags.danglingDeps.length}`);
console.log('epics:', plan.epics.map((e) => e.title).join(', '));
console.log(`\nboard → ${out}`);
