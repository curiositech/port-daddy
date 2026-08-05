#!/usr/bin/env node
/**
 * ci-gate verdict: decide whether the single required check passes.
 *
 * WHY THIS EXISTS AS ITS OWN FILE. ci-gate is the one status check branch
 * protection points at, so its verdict is the merge decision. It used to treat
 * `cancelled` identically to `failure`, and that is wrong in the single case it
 * fires most often.
 *
 * The workflow sets `cancel-in-progress` for pull_request events, keyed on the
 * PR number. So when an author pushes again, GitHub aborts the older run
 * mid-flight — by design, to free runners. Every job still in progress reports
 * `cancelled`, ci-gate called that a failure, and the PR grew a red required
 * check plus a failure notification for a commit nobody was waiting on. It has
 * happened five times on #4918 alone. Worse than the noise: agents and humans
 * both learn to discount a red ci-gate, which is exactly the signal that must
 * never be discounted.
 *
 * THE FIX IS NOT "IGNORE CANCELLED". A run cancelled by hand, or killed by
 * infrastructure, genuinely did not test anything, and passing it would let
 * untested code satisfy branch protection. That is a security-relevant
 * regression, not a papercut.
 *
 * The distinction that actually matters is whether this run's commit is still
 * the PR head. Check runs attach to the SHA they ran against, and branch
 * protection reads the HEAD sha — so once the branch has moved on, this run's
 * verdict cannot gate anything no matter what it says. A cancellation on a
 * commit that is no longer the head is therefore not a failure; it is a
 * non-event, and the newer run already in flight is the one that decides.
 *
 * A cancellation on a commit that IS still the head keeps failing, because
 * there is no successor run coming to supply the missing verdict.
 *
 * Real failures fail regardless of staleness. A stale `failure` is still worth
 * showing an author — the code that produced it is usually still in the branch.
 */

/** `needs.*.result` values GitHub can emit. */
export const RESULT_VALUES = ['success', 'failure', 'cancelled', 'skipped'];

/**
 * Decide the gate from the dependency results.
 *
 * PURE — no network, no env, no clock. The staleness input is resolved by the
 * caller precisely so this decision is auditable and testable offline.
 *
 * @param {Record<string, {result?: string}>} needs The `needs` context.
 * @param {boolean} stale True when this run's commit is no longer the PR head,
 *        i.e. a newer run has taken over. MUST be false whenever the caller
 *        could not determine it — see resolveStale, which fails closed.
 * @returns {{ok: boolean, message: string}} Verdict and the line to print.
 */
export function decideGate(needs, stale) {
  const entries = Object.entries(needs ?? {});
  const byResult = result => entries.filter(([, v]) => v?.result === result).map(([n]) => n).sort();

  const failed = byResult('failure');
  const cancelled = byResult('cancelled');

  // Failures are unconditional. Staleness never excuses one.
  if (failed.length) {
    const also = cancelled.length ? ` (also cancelled: ${cancelled.join(', ')})` : '';
    return { ok: false, message: `ci-gate FAILED — these jobs failed: ${failed.join(', ')}${also}` };
  }

  if (cancelled.length) {
    if (stale) {
      return {
        ok: true,
        message:
          `ci-gate SUPERSEDED — ${cancelled.join(', ')} were cancelled because a newer commit ` +
          `took over this PR. This run's commit is no longer the head, so its verdict cannot ` +
          `gate the merge; the run for the current head decides.`,
      };
    }
    return {
      ok: false,
      message:
        `ci-gate FAILED — these jobs were cancelled on the current head commit: ` +
        `${cancelled.join(', ')}. Nothing superseded this run, so no successor is coming ` +
        `to supply the missing result.`,
    };
  }

  return {
    ok: true,
    message: `ci-gate OK — all ${entries.length} dependencies succeeded or were skipped`,
  };
}

/**
 * Ask GitHub whether this run's commit is still the PR head.
 *
 * FAILS CLOSED. Every path that cannot produce a confident "yes, the branch
 * moved on" returns false, which routes {@link decideGate} back to the strict
 * behaviour. A network blip must never be the reason a cancelled run passes.
 *
 * @param {object} opts
 * @param {string} opts.eventName `github.event_name`.
 * @param {string} opts.repo `owner/name`.
 * @param {string} opts.prNumber PR number (empty for non-PR events).
 * @param {string} opts.runHeadSha The head SHA this run was triggered for.
 * @param {string} opts.token A token that can read the PR.
 * @param {typeof fetch} [opts.fetchImpl] Injected for tests.
 * @returns {Promise<boolean>} True only when the live head differs from ours.
 */
export async function resolveStale({ eventName, repo, prNumber, runHeadSha, token, fetchImpl }) {
  // Only pull_request runs are subject to cancel-in-progress; push and
  // merge_group use a per-SHA concurrency group and are never superseded.
  if (eventName !== 'pull_request') return false;
  if (!repo || !prNumber || !runHeadSha || !token) return false;

  const doFetch = fetchImpl ?? fetch;
  try {
    const res = await doFetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'port-daddy-ci-gate',
      },
    });
    if (!res.ok) return false;
    const body = await res.json();
    const liveHead = body?.head?.sha;
    if (typeof liveHead !== 'string' || liveHead.length < 7) return false;
    return liveHead !== runHeadSha;
  } catch {
    return false;
  }
}

// --- entrypoint -------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const raw = process.env.RESULTS ?? '{}';
  let needs;
  try {
    needs = JSON.parse(raw);
  } catch {
    console.error('ci-gate FAILED — could not parse the needs context');
    process.exit(1);
  }
  console.log(JSON.stringify(needs, null, 2));

  const stale = await resolveStale({
    eventName: process.env.EVENT_NAME ?? '',
    repo: process.env.GITHUB_REPOSITORY ?? '',
    prNumber: process.env.PR_NUMBER ?? '',
    runHeadSha: process.env.RUN_HEAD_SHA ?? '',
    token: process.env.GITHUB_TOKEN ?? '',
  });

  const { ok, message } = decideGate(needs, stale);
  console.log(message);
  process.exit(ok ? 0 : 1);
}
