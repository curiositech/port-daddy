import type { PrSnapshot } from './priority.js';

/**
 * Survey adapter — the seat's eyes on GitHub.
 *
 * DESIGN: the tick must never reason from stale beliefs (§5's sanity
 * protocol), so every wake re-reads the repo's live PR state through this
 * adapter and nothing is cached between wakes. The adapter's whole job is to
 * compress GitHub's several endpoints into the small typed {@link PrSnapshot}
 * the pure priority function consumes — evidence in, policy out, and the seam
 * between them is exactly this file, which is why the fetch function is
 * injectable (tests drive the real tick against a fake GitHub, the fleet
 * harness pattern).
 */

/** Label an operator applies to jump a PR to tier 1. */
export const OPERATOR_REQUEST_LABEL = 'steward:requested';

/** Branch prefixes and author patterns that mark a PR as fleet-owned. */
const FLEET_BRANCH_PREFIXES = ['claude/', 'fleet/', 'pd/'];

/** Minimal fetch signature so tests can inject a fake without global stubs. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Read every open PR plus its check/review state into snapshots.
 *
 * WHY REQUIRED-CHECKS = check-runs summary: the seat's charter forbids landing
 * over "a real red required check"; the closest honest read without per-branch
 * protection introspection (PR 3's territory, with the macaroon) is the check
 * runs on the head SHA — red if any completed run failed, pending if any is
 * still executing, green otherwise. Advisory-vs-required refinement arrives
 * with the landing machinery; until then the conservative read (any red = red)
 * can only make the seat MORE cautious, never less.
 *
 * @param owner - Repo owner.
 * @param repo - Repo name.
 * @param token - GitHub token (the seat's read credential).
 * @param fetchImpl - Fetch implementation; defaults to global fetch.
 * @returns Snapshots of open PRs; throws on a non-OK PR-list response
 * (a survey that cannot see is an infrastructure failure, not an empty repo).
 */
export async function surveyOpenPrs(
  owner: string,
  repo: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<PrSnapshot[]> {
  /**
   * One authenticated GitHub GET — the purpose of centralizing it is that
   * every survey read carries identical auth/agent headers and one error
   * shape, so a failing endpoint is diagnosable from the thrown path+status.
   * @param path - API path under api.github.com.
   * @returns The parsed JSON body.
   */
  const gh = async (path: string): Promise<unknown> => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'pd-steward',
      },
    });
    if (!res.ok) throw new Error(`survey GET ${path} -> ${res.status}`);
    return res.json();
  };

  const prs = (await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`)) as Array<
    Record<string, unknown>
  >;

  const snapshots: PrSnapshot[] = [];
  for (const pr of prs) {
    const number = Number(pr.number);
    const head = pr.head as { ref?: string; sha?: string } | undefined;
    const labels = Array.isArray(pr.labels)
      ? (pr.labels as Array<{ name?: string }>).map(l => String(l.name ?? ''))
      : [];
    const author = (pr.user as { login?: string; type?: string } | undefined) ?? {};

    // Checks and reviews are read per-PR, best-effort per item: one PR's
    // failed read degrades that PR to 'pending' (never docketed as actionable)
    // rather than failing the whole survey — one sick endpoint must not blind
    // the seat to every other PR.
    let checks: PrSnapshot['checks'] = 'pending';
    let approved = false;
    let changesRequested = false;
    try {
      const checkRuns = (await gh(
        `/repos/${owner}/${repo}/commits/${head?.sha}/check-runs?per_page=100`,
      )) as { check_runs?: Array<{ status?: string; conclusion?: string | null }> };
      const runs = checkRuns.check_runs ?? [];
      const anyRed = runs.some(
        r => r.status === 'completed' && ['failure', 'timed_out', 'cancelled'].includes(String(r.conclusion)),
      );
      const anyPending = runs.some(r => r.status !== 'completed');
      checks = anyRed ? 'red' : anyPending ? 'pending' : 'green';

      const reviews = (await gh(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`)) as Array<{
        state?: string;
        user?: { login?: string };
      }>;
      // Last review per reviewer wins — GitHub's own semantics.
      const lastByUser = new Map<string, string>();
      for (const r of reviews) {
        const login = r.user?.login;
        if (login && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')) {
          lastByUser.set(login, String(r.state));
        }
      }
      const states = [...lastByUser.values()];
      changesRequested = states.includes('CHANGES_REQUESTED');
      approved = !changesRequested && states.includes('APPROVED');
    } catch {
      checks = 'pending';
    }

    snapshots.push({
      number,
      title: String(pr.title ?? ''),
      draft: pr.draft === true,
      checks,
      approved,
      changesRequested,
      operatorRequested: labels.includes(OPERATOR_REQUEST_LABEL),
      fleetOwned:
        FLEET_BRANCH_PREFIXES.some(p => String(head?.ref ?? '').startsWith(p)) ||
        String(author.type ?? '') === 'Bot',
      mergeable: typeof pr.mergeable === 'boolean' ? pr.mergeable : null,
      updatedAt: Date.parse(String(pr.updated_at ?? '')) || 0,
    });
  }
  return snapshots;
}
