import type { FetchLike } from './survey.js';

/**
 * The landing hand — P1 PR 3 of THE_FULL_WHEEL.md §11: the machinery that
 * executes a LAND verdict.
 *
 * DESIGN (ADR-0109 made structural): exactly one seat holds the land
 * capability, and the capability is a dedicated secret (`STEWARD_LAND_TOKEN`)
 * that is deliberately NOT the survey token — read eyes and write hands are
 * separate credentials, separately revocable. The token must be a non-admin,
 * repo-scoped credential: GitHub's merge API refuses a non-admin token
 * whenever branch protection (required checks, reviews, merge queue) is
 * unsatisfied, so the charter's "never land over a real red required check"
 * is enforced by the platform, not by a prompt. Everything in this module is
 * a pure primitive with injectable fetch; the tick orchestrates them.
 */

/**
 * Path prefixes whose modification makes a PR "protected" — the surfaces
 * where a merge changes who can do what (CI definitions, release formulae,
 * the capability kernel, the relay's auth gate, the ADRs that constitute the
 * seat itself).
 *
 * WHY A FIXED V1 LIST: the protected set must be reviewable in the same diff
 * that grants the seat its hand — a config-driven list arrives later, once
 * the console (P4) can render it. Prefix match is deliberate: protecting a
 * directory protects everything ever added beneath it.
 */
export const PROTECTED_PATHS = [
  '.github/workflows/',
  'Formula/',
  'core/kernel/',
  'apps/relay/src/auth.ts',
  'docs/adr/',
] as const;

/**
 * Ceiling on how many changed files one landing check reads.
 *
 * RATIONALE: the files endpoint pages at 100; rather than paginate (and risk
 * an unbounded read inside a tick), a PR whose first page is full is treated
 * as protected — fail closed on what the seat could not fully see.
 */
export const PR_FILES_PAGE_SIZE = 100;

/** How many DISTINCT land-failure reasons put a PR on hold (clusterfudge seed). */
export const LAND_FAIL_HOLD_AT = 3;

/**
 * Storage key for an operator's ship-it grant on one PR.
 *
 * PURPOSE: grants are hot, consumable state (written by the operator route,
 * consumed by a successful land), so they live in DO storage, not D1 — the
 * append-only ledgers record what happened; storage records what is pending.
 *
 * @param prNumber - The PR the grant covers.
 * @returns The DO-storage key.
 */
export function shipItKey(prNumber: number): string {
  return `${SHIPIT_PREFIX}${prNumber}`;
}

/** Prefix for ship-it grant keys, exported so /status can list live grants. */
export const SHIPIT_PREFIX = 'shipit:';

/**
 * Storage key for the distinct-failure list of one PR's land attempts.
 *
 * WHY PER-PR: a PR that keeps failing to land in NEW ways is exhibiting the
 * clusterfudge signature (P1 PR 4's territory); counting distinct reasons per
 * PR lets the tick hold exactly the sick PR while landing everything else.
 *
 * @param prNumber - The PR whose failures are tracked.
 * @returns The DO-storage key.
 */
export function landFailKey(prNumber: number): string {
  return `landfails:${prNumber}`;
}

/** An operator's recorded ship-it grant. */
export interface ShipItGrant {
  /** Who granted it — always an operator surface (the admin-token gate). */
  grantedBy: string;
  /** Epoch milliseconds of the grant. */
  grantedAt: number;
}

/**
 * The slice of DO storage the tick's landing arm needs.
 *
 * DESIGN: `DurableObjectStorage` satisfies this structurally, and so does the
 * test harness's FakeStorage — the interface exists so tick.ts stays testable
 * with a Map-backed fake and never imports platform types it doesn't use.
 */
export interface SeatStore {
  /** Read one key. @param key - Storage key. @returns Value or undefined. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Write one key. @param key - Storage key. @param value - Value to store. @returns Resolves once stored. */
  put(key: string, value: unknown): Promise<void>;
  /** Remove one key. @param key - Storage key. @returns Platform-shaped result (ignored). */
  delete(key: string): Promise<unknown>;
}

/**
 * Decide whether a changed-file list touches a protected surface.
 *
 * WHY PURE + PREFIX MATCH: the decision must be re-derivable by a stranger
 * reading the deck log next to the PR's file list — no globbing engine, no
 * config lookup, just "does any changed path start with a protected prefix".
 *
 * @param files - Changed file paths from the PR.
 * @returns True when any file sits under a protected prefix.
 */
export function isProtectedPr(files: string[]): boolean {
  return files.some(f => PROTECTED_PATHS.some(p => f.startsWith(p)));
}

/**
 * Read the changed-file list of one PR (first page only, by design).
 *
 * MOTIVATION: called only at landing time — never during survey — so the
 * seat pays this read exactly when a LAND verdict is about to execute, not
 * on every docketed PR. Throws on a non-OK response: a landing check that
 * cannot see the files must hold, and the caller turns the throw into an
 * honest "could not read PR files" reason.
 *
 * @param owner - Repo owner.
 * @param repo - Repo name.
 * @param prNumber - The PR to read.
 * @param token - GitHub token (the survey read credential suffices).
 * @param fetchImpl - Injectable fetch; defaults to global fetch.
 * @returns Changed file paths (at most one page — see {@link PR_FILES_PAGE_SIZE}).
 */
export async function fetchPrFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PR_FILES_PAGE_SIZE}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'pd-steward',
      },
    },
  );
  if (!res.ok) throw new Error(`fetchPrFiles #${prNumber} -> ${res.status}`);
  const files = (await res.json()) as Array<{ filename?: string }>;
  return files.map(f => String(f.filename ?? ''));
}

/** What one land attempt did — the deck log prints `reason` verbatim. */
export interface LandResult {
  /** True when the squash merge succeeded. */
  landed: boolean;
  /** The merge commit SHA on success. */
  sha?: string;
  /** Honest one-liner: the merge SHA note, or the API's status + message. */
  reason: string;
}

/**
 * Execute one squash merge via GitHub's merge API.
 *
 * WHY SQUASH AND ONLY SQUASH: this repo disallows merge commits (proven live:
 * the merge method 405s; squash succeeds), and one landing method means one
 * auditable history shape. WHY NEVER THROW: the tick's deck-log write must
 * always be reached — every failure path returns `{landed: false, reason}`
 * carrying the API's status and message so the deck log names exactly why
 * (405 method/protection, 409 head-changed, 403 forbidden, 404 gone).
 *
 * @param opts - Repo coordinates, PR number, the land token, injectable fetch.
 * @returns The attempt's outcome; never rejects.
 */
export async function landPr(opts: {
  /** Repo owner. */
  owner: string;
  /** Repo name. */
  repo: string;
  /** The PR to land. */
  prNumber: number;
  /** The land capability — `STEWARD_LAND_TOKEN`, never the survey token. */
  token: string;
  /** Injectable fetch; defaults to global fetch. */
  fetchImpl?: FetchLike;
}): Promise<LandResult> {
  const { owner, repo, prNumber, token, fetchImpl = fetch } = opts;
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'pd-steward',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ merge_method: 'squash' }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { sha?: string; message?: string };
    if (res.ok && body.sha) {
      return { landed: true, sha: body.sha, reason: `squash-merged @ ${body.sha}` };
    }
    return {
      landed: false,
      reason: `merge API ${res.status}: ${String(body.message ?? 'no message').slice(0, 200)}`,
    };
  } catch (err) {
    return { landed: false, reason: `merge request failed: ${String(err).slice(0, 200)}` };
  }
}
