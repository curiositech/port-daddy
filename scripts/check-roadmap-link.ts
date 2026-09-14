/**
 * Roadmap-link gate — CI entry point (BLOCKING; required in branch protection).
 *
 *   npx tsx scripts/check-roadmap-link.ts            # CI: reads $GITHUB_EVENT_PATH
 *   npx tsx scripts/check-roadmap-link.ts 512        # local: inspect PR #512 via gh
 *   npx tsx scripts/check-roadmap-link.ts 512 --dry-run   # classify, mutate nothing
 *
 * Decides whether a PR declares the roadmap item it advances. On a pull_request
 * event this is a required declaration check: a missing trailer blocks, while
 * an explicit slug or reasoned opt-out passes. The versioned roadmap snapshot
 * is deliberately not merge authority; stale projection data cannot freeze
 * unrelated delivery. The workflow makes `merge_group` heads a pass-through (a rebase in
 * the queue can't change a roadmap declaration), so this script gates only at
 * pull_request time and a queued PR never hangs waiting for a report.
 *
 * I/O only — all decisions live in `lib/roadmap-link-core.ts` (unit-tested).
 * GitHub mutations go through the `gh` CLI so this needs no extra deps and runs
 * the same locally as in Actions.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  classifyDeclaration,
  type LinkResult,
} from '../lib/roadmap-link-core';

const LABEL = 'needs-roadmap-link';
const COMMENT_MARKER = '<!-- roadmap-link-gate -->';
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
      lines.push('', 'The item is introduced by this PR; Chartroom reconciliation can ingest it asynchronously.');
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
    default:
      lines.push('⚠️ The declaration needs operator review.');
  }
  lines.push('', '---', `<sub>Declaration check only. Durable truth and reconciliation live outside this versioned projection. · \`${r.reason}\`</sub>`);
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

const LABEL_DESC: Record<string, string> = {
  [LABEL]: 'PR does not link a roadmap item — needs human approval to land',
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
  const result = classifyDeclaration(pr.body);
  console.log(`PR #${pr.number}: declaration=${result.verdict}(${result.reason}) — ${result.headline}`);
  writeStepSummary(result, pr);

  const passed = result.verdict === 'pass';

  // Comment when the required declaration is missing or malformed.
  if (!passed) {
    upsertComment(pr, buildComment(result));
  }
  syncLabel(pr, LABEL, result.labelShouldBePresent);

  // `roadmap-link` is required, so absence of the explicit declaration blocks.
  // Snapshot freshness and slug reconciliation are asynchronous Chartroom work,
  // not merge admission. A versioned projection can never stop unrelated code.
  process.exit(passed ? 0 : 1);
}

main();
