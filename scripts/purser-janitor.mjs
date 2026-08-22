#!/usr/bin/env node
/**
 * Purser janitor — closes orphaned purser gate PRs when their implementation
 * PR ends, and flags carrier PRs instead of killing them.
 *
 *   node scripts/purser-janitor.mjs            # CI: reads $GITHUB_EVENT_PATH
 *   node scripts/purser-janitor.mjs 7487       # local: replay PR #7487's close
 *   node scripts/purser-janitor.mjs 7487 --dry-run
 *
 * WHY this exists: the purser cuts a `purser/pr-<n>-tests` branch per reviewed
 * PR and opens an adversarial-test PR from it. Nothing ever cleaned those up
 * when the reviewed PR ended, and by 2026-08-22 more than forty of them sat
 * open — a third of the whole open-PR backlog. This janitor runs on every PR
 * close and retires the gate PR the moment its purpose is gone.
 *
 * DESIGN — the one distinction that matters (learned the hard way during the
 * 2026-08-22 backlog sweep, where a naive "parent merged ⇒ purser obsolete"
 * rule closed live carriers): the purser sometimes retargets the reviewed PR
 * onto its own test branch, so "merging" the reviewed PR merges it INTO
 * `purser/pr-<n>-tests`, and the purser PR becomes the CARRIER — the only
 * remaining path for that work to reach main. A carrier must never be
 * auto-closed; it gets a loud "ready to drive to main" note instead. Only two
 * cases retire the gate PR: the reviewed PR closed unmerged, or it merged
 * somewhere other than its purser branch (so the tests' target landed on its
 * own and the gate has nothing left to gate).
 *
 * Decisions live in pure functions below (unit-tested by
 * scripts/purser-janitor.test.mjs, which the workflow runs before trusting a
 * single mutation); all I/O goes through the `gh` CLI so the script behaves
 * identically in Actions and on a laptop.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MARKER = '<!-- purser-janitor -->';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Name the purser gate branch for a reviewed PR.
 *
 * Purpose: one authoritative place for the `purser/pr-<n>-tests` naming
 * contract this janitor shares with the fleet executor
 * (apps/fleet-executor/src/purser.ts) — if that convention ever changes, this
 * is the single seam to update.
 *
 * @param {number} prNumber The reviewed (implementation) PR's number.
 * @returns {string} The purser branch name for that PR.
 */
export function purserBranchFor(prNumber) {
  return `purser/pr-${prNumber}-tests`;
}

/**
 * Decide every janitor action for one closed PR.
 *
 * Why pure: the mutations here (closing PRs, posting notes) are exactly the
 * kind of automation that silently eats real work when its edge cases are
 * wrong, so the whole decision table lives in one side-effect-free function
 * the test suite can hammer — the CLI layer below only fetches inputs and
 * executes the returned actions.
 *
 * The intent of each action type:
 *  - `close`   → the purser gate PR for the closed reviewed PR is obsolete
 *                (reviewed PR closed unmerged, or merged away from its purser
 *                branch). Close it, branch preserved.
 *  - `carrier` → the reviewed PR merged INTO its purser branch, so the still
 *                -open purser PR now carries that work; never close it, post
 *                a "ready to drive to main" note so it reads as a merge
 *                candidate, not leftovers.
 *  - `orphan`  → the closed PR died unmerged while other open PRs still base
 *                on its head branch; tell those PRs their base is a dead end
 *                (retarget or close). When the closed PR MERGED, GitHub's own
 *                base-retargeting handles its dependents, so we stay quiet.
 *
 * @param {{number: number, merged: boolean, headRef: string, baseRef: string}} closedPr
 *   The PR that just closed, as reported by the pull_request closed event.
 * @param {{number: number, headRef: string, baseRef: string}[]} openPrs
 *   Currently-open PRs whose head is the closed PR's purser branch or whose
 *   base is the closed PR's head branch (pre-filtered lists are fine; extra
 *   unrelated PRs are ignored).
 * @returns {{type: 'close'|'carrier'|'orphan', prNumber: number, body: string}[]}
 *   Ordered actions for the I/O layer to execute.
 */
export function decideJanitorActions(closedPr, openPrs) {
  const actions = [];
  const gateBranch = purserBranchFor(closedPr.number);
  const mergedIntoOwnGate = closedPr.merged && closedPr.baseRef === gateBranch;

  for (const pr of openPrs) {
    if (pr.headRef === gateBranch && pr.number !== closedPr.number) {
      if (mergedIntoOwnGate) {
        actions.push({
          type: 'carrier',
          prNumber: pr.number,
          body:
            `${MARKER}\n#${closedPr.number} merged **into this branch** ` +
            `(\`${gateBranch}\`), so this PR is now the carrier for that work — ` +
            `it reaches \`main\` only when this PR lands. Treat this as a live ` +
            `merge candidate, not a leftover gate.`,
        });
      } else {
        const why = closedPr.merged
          ? `#${closedPr.number} merged into \`${closedPr.baseRef}\``
          : `#${closedPr.number} was closed without merging`;
        actions.push({
          type: 'close',
          prNumber: pr.number,
          body:
            `${MARKER}\n${why}, so this adversarial-test gate PR has nothing ` +
            `left to gate. Closing it; the tests remain on \`${gateBranch}\` ` +
            `if anyone wants to salvage them.`,
        });
      }
    }
  }

  if (!closedPr.merged) {
    for (const pr of openPrs) {
      if (pr.baseRef === closedPr.headRef && pr.number !== closedPr.number) {
        actions.push({
          type: 'orphan',
          prNumber: pr.number,
          body:
            `${MARKER}\nThis PR's base branch \`${closedPr.headRef}\` belongs ` +
            `to #${closedPr.number}, which was just closed **without merging**. ` +
            `This PR is orphaned as written — retarget it onto \`main\` (or ` +
            `the surviving base) or close it.`,
        });
      }
    }
  }

  return actions;
}

/** Thin wrapper so every gh invocation is uniform and capture-friendly. */
function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/**
 * Resolve the closed PR under janitorial review.
 *
 * Design: mirrors scripts/check-roadmap-link.ts — a CLI arg replays any PR
 * locally for debugging, while CI reads the Actions event JSON, so the exact
 * production code path is reproducible from a laptop with only `gh` auth.
 *
 * @param {string} repo `owner/name` slug the gh calls target.
 * @returns {{number: number, merged: boolean, headRef: string, baseRef: string}|null}
 */
function resolveClosedPr(repo) {
  const arg = process.argv[2];
  if (arg && /^\d+$/.test(arg)) {
    const pr = JSON.parse(
      gh(['pr', 'view', arg, '--repo', repo, '--json', 'number,state,mergedAt,headRefName,baseRefName']),
    );
    if (pr.state === 'OPEN') {
      console.log(`PR #${arg} is still open — nothing for the janitor to do.`);
      return null;
    }
    return {
      number: pr.number,
      merged: Boolean(pr.mergedAt),
      headRef: pr.headRefName,
      baseRef: pr.baseRefName,
    };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('No PR number argument and no $GITHUB_EVENT_PATH — nothing to do.');
    process.exit(1);
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr || pr.state !== 'closed') {
    console.log('Event carries no closed pull_request — skipping.');
    return null;
  }
  return {
    number: pr.number,
    merged: Boolean(pr.merged),
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
  };
}

/**
 * Fetch the open PRs the decision core needs: gate-branch heads and
 * dependents based on the closed PR's head.
 *
 * Why filtered server-side: `gh pr list --head/--base` keeps this O(1) API
 * calls instead of paging the whole open-PR list on a busy repo.
 *
 * @param {string} repo `owner/name` slug.
 * @param {{number: number, headRef: string}} closedPr The closed PR.
 * @returns {{number: number, headRef: string, baseRef: string}[]}
 */
function fetchCandidates(repo, closedPr) {
  const fields = 'number,headRefName,baseRefName';
  const parse = (raw) =>
    JSON.parse(raw).map((p) => ({ number: p.number, headRef: p.headRefName, baseRef: p.baseRefName }));
  const gatePrs = parse(
    gh(['pr', 'list', '--repo', repo, '--state', 'open', '--head', purserBranchFor(closedPr.number), '--json', fields]),
  );
  const dependents = parse(
    gh(['pr', 'list', '--repo', repo, '--state', 'open', '--base', closedPr.headRef, '--json', fields]),
  );
  const seen = new Set();
  return [...gatePrs, ...dependents].filter((p) => !seen.has(p.number) && seen.add(p.number));
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || 'curiositech/port-daddy';
  const closedPr = resolveClosedPr(repo);
  if (!closedPr) return;

  const candidates = fetchCandidates(repo, closedPr);
  const actions = decideJanitorActions(closedPr, candidates);
  if (!actions.length) {
    console.log(`No janitor actions for closed PR #${closedPr.number}.`);
    return;
  }
  for (const action of actions) {
    console.log(`[${action.type}] PR #${action.prNumber}${DRY_RUN ? ' (dry-run)' : ''}`);
    if (DRY_RUN) continue;
    gh(['pr', 'comment', String(action.prNumber), '--repo', repo, '--body', action.body]);
    if (action.type === 'close') {
      gh(['pr', 'close', String(action.prNumber), '--repo', repo]);
    }
  }
}

// Only run the CLI when executed directly, so the test suite can import the
// pure core without side effects.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
