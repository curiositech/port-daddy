/**
 * Roadmap-link gate — CI entry point (non-blocking).
 *
 *   npx tsx scripts/check-roadmap-link.ts            # CI: reads $GITHUB_EVENT_PATH
 *   npx tsx scripts/check-roadmap-link.ts 512        # local: inspect PR #512 via gh
 *   npx tsx scripts/check-roadmap-link.ts 512 --dry-run   # classify, mutate nothing
 *
 * Decides whether a PR declares the roadmap item it advances and, when it does
 * not, marks it `needs-roadmap-link` so the auto-merger holds it for a human.
 * This job is intentionally NOT a required status check — it never blocks a
 * merge mechanically. Its teeth are the label (which the land flow respects)
 * plus a loud comment + step summary when the roadmap itself is broken.
 *
 * I/O only — all decisions live in `lib/roadmap-link-core.ts` (unit-tested).
 * GitHub mutations go through the `gh` CLI so this needs no extra deps and runs
 * the same locally as in Actions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classify, type RoadmapSnapshot, type LinkResult } from '../lib/roadmap-link-core';

const LABEL = 'needs-roadmap-link';
const COMMENT_MARKER = '<!-- roadmap-link-gate -->';
const SNAPSHOT_PATH = resolve('docs/roadmap/roadmap.snapshot.json');
const DRY_RUN = process.argv.includes('--dry-run');

interface PrInfo {
  number: number;
  body: string;
  labels: string[];
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Resolve the PR under test: from a CLI arg (+gh) or from the Actions event JSON. */
function resolvePr(): PrInfo | null {
  const argNum = process.argv.find((a) => /^\d+$/.test(a));
  if (argNum) {
    const json = JSON.parse(gh(['pr', 'view', argNum, '--json', 'number,body,labels']));
    return {
      number: json.number,
      body: json.body ?? '',
      labels: (json.labels ?? []).map((l: { name: string }) => l.name),
    };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) return null;
  return {
    number: pr.number,
    body: pr.body ?? '',
    labels: (pr.labels ?? []).map((l: { name: string }) => l.name),
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

function syncLabel(pr: PrInfo, want: boolean): void {
  const has = pr.labels.includes(LABEL);
  if (want === has) return;
  const flag = want ? '--add-label' : '--remove-label';
  if (DRY_RUN) {
    console.log(`[dry-run] gh pr edit ${pr.number} ${flag} ${LABEL}`);
    return;
  }
  try {
    gh(['pr', 'edit', String(pr.number), flag, LABEL]);
  } catch {
    // Label may not exist yet on a fresh repo; create then retry add.
    if (want) {
      try {
        gh(['label', 'create', LABEL, '--color', 'B60205', '--description', 'PR does not link a roadmap item — needs human approval to land', '--force']);
        gh(['pr', 'edit', String(pr.number), '--add-label', LABEL]);
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

  console.log(`PR #${pr.number}: ${result.verdict} (${result.reason}) — ${result.headline}`);
  writeStepSummary(result, pr);

  const passed = result.verdict === 'pass';
  // Only nag with a comment when there's something to fix or shout about.
  if (!passed) upsertComment(pr, buildComment(result));
  syncLabel(pr, result.labelShouldBePresent);

  // Non-blocking: a red check here is a visible signal, but this job is NOT in
  // the required-checks list, so it cannot stop a merge on its own. The label
  // is what makes the land wait for a human.
  process.exit(passed ? 0 : 1);
}

main();
