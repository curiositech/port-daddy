/**
 * Roadmap-link gate — CI entry point (BLOCKING; required in branch protection).
 *
 *   npx tsx scripts/check-roadmap-link.ts            # CI: reads $GITHUB_EVENT_PATH
 *   npx tsx scripts/check-roadmap-link.ts 512        # local: inspect PR #512 via gh
 *   npx tsx scripts/check-roadmap-link.ts 512 --dry-run   # classify, mutate nothing
 *
 * Decides whether a PR declares the roadmap item it advances. On a pull_request
 * event this is a REQUIRED, fail-closed status check (the operator promoted it,
 * 2026-06): any non-pass verdict exits non-zero and BLOCKS the merge — that is
 * the bounce-back. It also marks `needs-roadmap-link` so the land flow holds it
 * for a human, and posts a loud comment + step summary when the roadmap itself
 * is broken. The workflow makes `merge_group` heads a pass-through (a rebase in
 * the queue can't change a roadmap declaration), so this script gates only at
 * pull_request time and a queued PR never hangs waiting for a report.
 *
 * I/O only — all decisions live in `lib/roadmap-link-core.ts` (unit-tested).
 * GitHub mutations go through the `gh` CLI so this needs no extra deps and runs
 * the same locally as in Actions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  classify,
  classifyPlanningSpawn,
  type RoadmapSnapshot,
  type LinkResult,
  type SpawnResult,
} from '../lib/roadmap-link-core';

const LABEL = 'needs-roadmap-link';
const SPAWN_LABEL = 'needs-roadmap-spawn';
const COMMENT_MARKER = '<!-- roadmap-link-gate -->';
const SNAPSHOT_PATH = resolve('docs/roadmap/roadmap.snapshot.json');
const DRY_RUN = process.argv.includes('--dry-run');

interface PrInfo {
  number: number;
  body: string;
  labels: string[];
  files: string[];
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Resolve the PR under test: from a CLI arg (+gh) or from the Actions event JSON. */
function resolvePr(): PrInfo | null {
  const argNum = process.argv.find((a) => /^\d+$/.test(a));
  if (argNum) {
    const json = JSON.parse(gh(['pr', 'view', argNum, '--json', 'number,body,labels,files']));
    return {
      number: json.number,
      body: json.body ?? '',
      labels: (json.labels ?? []).map((l: { name: string }) => l.name),
      files: (json.files ?? []).map((f: { path: string }) => f.path),
    };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) return null;
  // The pull_request event payload has no file list; ask gh for it.
  let files: string[] = [];
  try {
    files = gh(['pr', 'view', String(pr.number), '--json', 'files', '-q', '.files[].path'])
      .split('\n')
      .filter(Boolean);
  } catch {
    /* file-derived rules just won't fire */
  }
  return {
    number: pr.number,
    body: pr.body ?? '',
    labels: (pr.labels ?? []).map((l: { name: string }) => l.name),
    files,
  };
}

function loadSnapshot(): RoadmapSnapshot | null {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as RoadmapSnapshot;
  } catch {
    return null; // missing/unparseable → core treats as "broken"
  }
}

function buildComment(r: LinkResult): string {
  const lines: string[] = [COMMENT_MARKER, '### 🗺️ Roadmap link gate', ''];
  const linkCmd = (slug?: string) =>
    [
      '```bash',
      `# create the item if needed, then stamp the PR (run locally, daemon required):`,
      `npx tsx scripts/roadmap-link.ts ${r.slug ?? slug ?? '<pr-number>'}`,
      '```',
    ].join('\n');

  switch (r.reason) {
    case 'linked':
      lines.push(`✅ Linked to roadmap item **\`${r.slug}\`**. Good to land.`);
      break;
    case 'self-spawned':
      lines.push(
        `✅ Linked to **\`${r.slug}\`**, declared by this PR's own \`Roadmap-Spawns:\` trailer.`,
      );
      lines.push('', 'The item is introduced by this PR; the snapshot catches up at the next `export-roadmap-snapshot` run.');
      break;
    case 'opt-out':
      lines.push(`✅ Explicit opt-out accepted — _${r.optOutReason}_.`);
      lines.push('', 'No roadmap item required for this change.');
      break;
    case 'missing-trailer':
      lines.push('⚠️ **This PR does not link a roadmap item.**', '');
      lines.push('Add one of these to the PR description:', '');
      lines.push('```', 'Roadmap-Item: <slug>', '# or, for a chore/docs/hotfix:', 'Roadmap-Item: none — <reason>', '```');
      lines.push('', "Don't know the slug? Create the item and stamp the PR in one step:", '', linkCmd());
      lines.push('', `Until then this PR carries \`${LABEL}\` and **needs a human to approve the land.**`);
      break;
    case 'unknown-slug':
      lines.push(`⚠️ **\`${r.slug}\` is not a known roadmap item.**`, '');
      lines.push('Either fix the typo, or create it (and re-stamp) with:', '', linkCmd());
      lines.push('', `This PR carries \`${LABEL}\` and **needs a human to approve the land.**`);
      break;
    case 'snapshot-missing':
      lines.push('🔴 **THE ROADMAP SNAPSHOT IS MISSING OR UNREADABLE.**', '');
      lines.push('`docs/roadmap/roadmap.snapshot.json` did not parse. The gate cannot verify any link.');
      lines.push('', 'Regenerate it from the daemon and commit:', '', '```bash', 'npx tsx scripts/export-roadmap-snapshot.ts', '```');
      break;
    case 'snapshot-empty':
      lines.push('🔴 **THE ROADMAP SNAPSHOT HAS ZERO ITEMS.**', '');
      lines.push('The export is broken — every PR would fail this gate. Regenerate and commit:', '');
      lines.push('```bash', 'npx tsx scripts/export-roadmap-snapshot.ts', '```');
      break;
    case 'snapshot-stale':
      lines.push('🔴 **THE ROADMAP SNAPSHOT IS STALE.**', '');
      lines.push(r.headline, '', 'Regenerate it so links validate against current truth:', '');
      lines.push('```bash', 'npx tsx scripts/export-roadmap-snapshot.ts', '```');
      break;
  }
  lines.push('', '---', `<sub>Non-blocking check. Land truth lives in the daemon; this reads the committed mirror. · \`${r.reason}\`</sub>`);
  return lines.join('\n');
}

function spawnSection(s: SpawnResult): string[] {
  if (!s.isPlanning) return [];
  const lines: string[] = ['', '### 📐 Planning-doc spawn check', ''];
  const files = s.planningFiles.map((f) => `\`${f.split('/').pop()}\``).join(', ');
  switch (s.reason) {
    case 'spawns-declared':
      lines.push(`✅ Declares ${s.spawnedSlugs.length} downstream item(s): ${s.spawnedSlugs.map((x) => `\`${x}\``).join(', ')}.`);
      break;
    case 'spawn-opt-out':
      lines.push(`✅ ${s.headline}`);
      break;
    case 'missing-spawns':
      lines.push(`⚠️ This PR changes a planning doc (${files}) but **declares no downstream roadmap items.**`, '');
      lines.push('A plan/ADR exists to create work. List the items it spawns:', '');
      lines.push('```', 'Roadmap-Spawns: <slug-a>, <slug-b>, <slug-c>', '# or, if it only supersedes/clarifies with no new work:', 'Roadmap-Spawns: none — <reason>', '```');
      lines.push('', `Until then this PR carries \`${SPAWN_LABEL}\` and **needs a human to approve the land.**`);
      break;
  }
  return lines;
}

function writeStepSummary(r: LinkResult, pr: PrInfo): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  const icon = r.verdict === 'pass' ? '✅' : r.loud ? '🔴' : '⚠️';
  const rows = [
    `## ${icon} Roadmap link gate — PR #${pr.number}`,
    '',
    `| field | value |`,
    `| --- | --- |`,
    `| verdict | \`${r.verdict}\` |`,
    `| reason | \`${r.reason}\` |`,
    `| slug | ${r.slug ? `\`${r.slug}\`` : '—'} |`,
    `| needs human approval | ${r.requiresHumanApproval ? 'yes' : 'no'} |`,
    `| roadmap broken/stale | ${r.loud ? '**yes — fix it**' : 'no'} |`,
    '',
    r.headline,
  ].join('\n');
  try {
    execFileSync('bash', ['-c', `cat >> "${summaryFile}"`], { input: `${rows}\n` });
  } catch {
    /* summary is best-effort */
  }
}

const LABEL_DESC: Record<string, string> = {
  [LABEL]: 'PR does not link a roadmap item — needs human approval to land',
  [SPAWN_LABEL]: 'Planning doc declares no downstream roadmap items — needs human approval to land',
};

function syncLabel(pr: PrInfo, label: string, want: boolean): void {
  const has = pr.labels.includes(label);
  if (want === has) return;
  const flag = want ? '--add-label' : '--remove-label';
  if (DRY_RUN) {
    console.log(`[dry-run] gh pr edit ${pr.number} ${flag} ${label}`);
    return;
  }
  try {
    gh(['pr', 'edit', String(pr.number), flag, label]);
  } catch {
    // Label may not exist yet on a fresh repo; create then retry add.
    if (want) {
      try {
        gh(['label', 'create', label, '--color', 'B60205', '--description', LABEL_DESC[label] ?? '', '--force']);
        gh(['pr', 'edit', String(pr.number), '--add-label', label]);
      } catch { /* non-fatal */ }
    }
  }
}

function upsertComment(pr: PrInfo, body: string): void {
  if (DRY_RUN) {
    console.log('[dry-run] would upsert comment:\n' + body);
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  try {
    const listArgs = repo
      ? ['api', `repos/${repo}/issues/${pr.number}/comments`, '--paginate']
      : ['pr', 'view', String(pr.number), '--json', 'comments'];
    let existingId: number | null = null;
    if (repo) {
      const comments = JSON.parse(gh(listArgs)) as Array<{ id: number; body: string }>;
      existingId = comments.find((c) => c.body.includes(COMMENT_MARKER))?.id ?? null;
    }
    if (existingId && repo) {
      gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${existingId}`, '-f', `body=${body}`]);
    } else {
      gh(['pr', 'comment', String(pr.number), '--body', body]);
    }
  } catch {
    // Comment is best-effort; the label + summary still carry the signal.
    console.log('(could not post comment — label + step summary still applied)');
  }
}

function main(): void {
  const pr = resolvePr();
  if (!pr) {
    console.log('No pull request in context (not a PR event) — skipping roadmap link gate.');
    process.exit(0);
  }
  const snapshot = loadSnapshot();
  const result = classify(pr.body, snapshot);
  const spawn = classifyPlanningSpawn(pr.body, pr.files);

  console.log(`PR #${pr.number}: link=${result.verdict}(${result.reason}) spawn=${spawn.reason} — ${result.headline}`);
  writeStepSummary(result, pr);

  const linkPass = result.verdict === 'pass';
  const spawnPass = spawn.verdict === 'pass';
  const passed = linkPass && spawnPass;

  // Comment when there's something to fix or shout about (link or spawn).
  if (!passed) {
    const body = [buildComment(result), ...spawnSection(spawn)].join('\n');
    upsertComment(pr, body);
  }
  syncLabel(pr, LABEL, result.labelShouldBePresent);
  syncLabel(pr, SPAWN_LABEL, spawn.labelShouldBePresent);

  // Required + fail-closed: `roadmap-link` is in branch protection's required
  // checks, so a non-zero exit here blocks the merge. Any non-pass blocks —
  // an author-fixable miss (no/typo'd `Roadmap-Item:`, a planning doc with no
  // spawns) OR a broken/stale snapshot. The operator chose fail-closed so a
  // stale mirror can never read as "all clear"; keep it fresh with
  // `npx tsx scripts/export-roadmap-snapshot.ts`. The label + comment still fire
  // so the fix is obvious. (merge_group is a workflow pass-through, so this only
  // gates at pull_request time.)
  process.exit(passed ? 0 : 1);
}

main();
