#!/usr/bin/env node
/**
 * Which merged PRs never reached main?
 *
 * A PR whose base is another feature branch is not shipped when it merges — it
 * moves one branch sideways, and GitHub says "Merged" either way. That badge
 * retires the work from everyone's attention while leaving it outside the
 * product. This finds the ones that never made it the rest of the way.
 *
 * WHY TWO TESTS AND NOT ONE. Neither is sufficient alone:
 *
 *   ancestry  — `git merge-base --is-ancestor <head> main` is what you reach for
 *               first and it is nearly useless here. main takes most work by
 *               squash or rebase, which rewrites the commits, so a branch tip is
 *               almost never an ancestor of main even when its content shipped.
 *               Run over this repo's live branches it called 895 of 917
 *               "unmerged", which is an artifact, not a finding.
 *   patch-id  — `git cherry` compares by patch-id and DOES survive squash and
 *               rebase. But it fails on content that landed in edited form: a
 *               conflict resolved during the rebase changes the patch, so a PR
 *               whose work is in main can still read as absent.
 *   files     — did the files this PR ADDED end up in main at all? Coarse (it
 *               says nothing about modifications) but it does not care how the
 *               content got there.
 *
 * So: patch-id absence is the candidate signal, and a PR is only reported as
 * STRANDED when the files it added are also missing. Anything that fails one
 * test and passes the other is reported as LANDED-REWRITTEN, which is a real
 * and common state, not a defect.
 *
 * Usage:
 *   node scripts/find-stranded-prs.mjs                 # since PR #5000
 *   node scripts/find-stranded-prs.mjs --since 9000
 *   node scripts/find-stranded-prs.mjs --json
 *
 * Needs `gh`-equivalent access for the PR list: pass one in with --prs a,b,c to
 * run purely offline, otherwise it reads .stranded-prs.json if present.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const SINCE = Number(flag('since', '5000'));
const JSON_OUT = argv.includes('--json');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitOk = (...args) => {
  try { execFileSync('git', args, { stdio: 'ignore' }); return true; } catch { return false; }
};

/**
 * The PR numbers to examine: merged, and merged into something other than main.
 *
 * There is no way to ask git for this — the base branch of a PR is GitHub's
 * fact, not the repository's — so the list comes in from outside. `--prs`
 * for a one-off, or a committed .stranded-prs.json for CI. The GitHub query
 * that produces it is:
 *   is:pr is:merged -base:main
 */
function prNumbers() {
  const inline = flag('prs', null);
  if (inline) return inline.split(',').map(Number).filter(Boolean);
  if (existsSync('.stranded-prs.json')) {
    return JSON.parse(readFileSync('.stranded-prs.json', 'utf8')).prs.map(Number);
  }
  console.error(
    'No PR list. Pass --prs 123,456 or commit .stranded-prs.json with {"prs":[...]},\n' +
      'built from: gh pr list --search "is:merged -base:main" --json number',
  );
  process.exit(2);
}

/** Fetch every PR head in one round trip; GitHub keeps refs/pull/N/head forever. */
function fetchHeads(numbers) {
  const refs = numbers.map((n) => `+refs/pull/${n}/head:refs/prheads/${n}`);
  // One fetch, not N: each is a network round trip and the list runs to hundreds.
  execFileSync('git', ['fetch', '--quiet', 'origin', ...refs], { stdio: 'inherit' });
}

function classify(n) {
  const ref = `refs/prheads/${n}`;
  if (!gitOk('rev-parse', '--verify', `${ref}^{commit}`)) return { n, verdict: 'NO-HEAD' };
  const head = git('rev-parse', ref);
  // Some heads share no history with main at all — a fork, or a branch cut
  // before a history rewrite. There is nothing to compare, and dying here would
  // hide every PR after it in the list.
  let base;
  try { base = git('merge-base', head, 'origin/main'); }
  catch { return { n, verdict: 'NO-COMMON-HISTORY', commitsAbsent: 0, commitsTotal: 0, addedFiles: 0, addedFilesOnMain: 0, branches: [] }; }

  // Patch-id: '+' lines are commits with no equivalent in main.
  const cherry = git('cherry', 'origin/main', head).split('\n').filter(Boolean);
  const absent = cherry.filter((l) => l.startsWith('+')).length;
  const total = cherry.length;

  // Added files: do they exist on main under any history?
  const added = git('diff', '--diff-filter=A', '--name-only', base, head).split('\n').filter(Boolean);
  const present = added.filter((f) => gitOk('cat-file', '-e', `origin/main:${f}`)).length;

  const allCommitsAbsent = total > 0 && absent === total;
  const noAddedFilesLanded = added.length > 0 && present === 0;

  let verdict;
  if (allCommitsAbsent && noAddedFilesLanded) verdict = 'STRANDED';
  else if (allCommitsAbsent && added.length === 0) verdict = 'STRANDED-UNCERTAIN'; // modification-only
  else if (absent === 0) verdict = 'LANDED';
  else verdict = 'LANDED-REWRITTEN';

  const branches = git('branch', '-r', '--contains', head)
    .split('\n').map((s) => s.trim().replace(/^origin\//, ''))
    .filter((b) => b && !b.startsWith('HEAD'));

  return { n, verdict, commitsAbsent: absent, commitsTotal: total, addedFiles: added.length, addedFilesOnMain: present, branches };
}

const numbers = prNumbers().filter((n) => n >= SINCE).sort((a, b) => b - a);
fetchHeads(numbers);
git('fetch', 'origin', 'main');
const rows = numbers.map(classify);

if (JSON_OUT) {
  console.log(JSON.stringify({ since: SINCE, examined: rows.length, rows }, null, 2));
} else {
  const by = (v) => rows.filter((r) => r.verdict === v);
  console.log(`examined ${rows.length} merged PR(s) with a non-main base, #${SINCE}+\n`);
  for (const v of ['STRANDED', 'STRANDED-UNCERTAIN', 'LANDED-REWRITTEN', 'LANDED', 'NO-HEAD', 'NO-COMMON-HISTORY']) {
    const g = by(v);
    if (!g.length) continue;
    console.log(`${v}  (${g.length})`);
    if (v.startsWith('STRANDED')) {
      for (const r of g) {
        const where = r.branches.length ? r.branches.slice(0, 2).join(', ') : 'no live branch — head is orphaned';
        console.log(`  #${r.n}  ${r.commitsAbsent}/${r.commitsTotal} commits absent, ${r.addedFilesOnMain}/${r.addedFiles} added files on main  [${where}]`);
      }
    }
    console.log('');
  }
  const stranded = by('STRANDED').length;
  if (stranded > 0) {
    console.log(`${stranded} PR(s) say "Merged" and are not in the product. See AGENTS.md,`);
    console.log('"Base main. Do not stack PRs onto feature branches."');
  }
  process.exitCode = 0; // a report, not a gate: this is history, not the current diff
}
