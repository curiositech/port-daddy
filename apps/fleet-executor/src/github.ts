/**
 * GitHub API helpers for the cloud fleet executor.
 *
 * Uses the GitHub App installation token (minted from the App private key JWT)
 * to fetch PR diffs, repo files, and post review comments.
 *
 * No Node.js dependencies — all crypto via Web Crypto API so this runs in
 * Cloudflare Workers.
 *
 * Copied from PR #549 (apps/github-app-receiver/src/github.ts) with ZERO
 * behavioral changes, plus a KV-backed installation-token cache wrapper
 * (`getInstallationTokenCached`) for the queue-consumer hot path where a single
 * fleet run authenticates several ships back-to-back against the same repo.
 */

// ---------------------------------------------------------------------------
// GitHub App JWT (no @octokit/auth-app — Workers-native Web Crypto)

async function signJwt(payload: Record<string, unknown>, pemKey: string): Promise<string> {
  // Decode PEM → DER
  const pem = pemKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const input = `${headerB64}.${payloadB64}`;

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${input}.${sigB64}`;
}

export async function mintAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iat: now - 60, exp: now + 540, iss: appId }, privateKeyPem);
}

interface InstallationTokenResponse {
  token: string;
  /** ISO-8601 expiry (~1h out). Optional in some legacy responses. */
  expires_at?: string;
}

/**
 * Mint a fresh installation access token (no cache). One JWT mint + one POST.
 * Returns the token and its expiry epoch-ms (best effort — defaults to +55min
 * if GitHub omits `expires_at`).
 */
async function mintInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<{ token: string; expiresAt: number }> {
  const jwt = await mintAppJwt(appId, privateKeyPem);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'port-daddy-fleet/1.0',
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub App token mint failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as InstallationTokenResponse;
  const expiresAt = body.expires_at
    ? new Date(body.expires_at).getTime()
    : Date.now() + 55 * 60 * 1000;
  return { token: body.token, expiresAt };
}

/**
 * Backwards-compatible signature (matches #549). Always mints fresh.
 * Prefer {@link getInstallationTokenCached} in the executor hot path.
 */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<string> {
  const { token } = await mintInstallationToken(appId, privateKeyPem, installationId);
  return token;
}

/**
 * KV-backed installation-token cache.
 *
 * - Key `github_inst_<installationId>`, value `{ token, expiresAt }`.
 * - A cache hit is honored only while >60s of life remains, so callers never
 *   race the GitHub 1h expiry mid-fleet.
 * - On a miss/expiry, mints fresh and writes back with TTL = expiresAt-60s.
 *
 * `forceRefresh` bypasses the cache (used by the 401 remint path below).
 */
export async function getInstallationTokenCached(
  appId: string,
  privateKeyPem: string,
  installationId: number,
  kv: KVNamespace,
  forceRefresh = false,
): Promise<string> {
  const key = `github_inst_${installationId}`;

  if (!forceRefresh) {
    const cached = await kv.get(key);
    if (cached) {
      try {
        const { token, expiresAt } = JSON.parse(cached) as { token: string; expiresAt: number };
        if (token && Date.now() < expiresAt - 60_000) return token;
      } catch {
        // corrupt cache entry — fall through to remint
      }
    }
  }

  const { token, expiresAt } = await mintInstallationToken(appId, privateKeyPem, installationId);

  const ttlSeconds = Math.floor((expiresAt - Date.now() - 60_000) / 1000);
  // KV requires expirationTtl >= 60. Skip caching if the token is already too
  // short-lived to be worth storing.
  if (ttlSeconds >= 60) {
    await kv.put(key, JSON.stringify({ token, expiresAt }), { expirationTtl: ttlSeconds });
  }

  return token;
}

/**
 * Invalidate the cached token for an installation (e.g. on a 401 from GitHub).
 */
export async function invalidateInstallationToken(
  installationId: number,
  kv: KVNamespace,
): Promise<void> {
  await kv.delete(`github_inst_${installationId}`);
}

// ---------------------------------------------------------------------------
// PR helpers

export interface PRFile {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
}

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  headSha: string;
  /**
   * The PR's head BRANCH name (e.g. 'feat/widget'). Empty when the payload
   * omits it. Used as the BASE of an ideation ship's stacked-fix PR so the
   * ship's code lands ON TOP of the review diff.
   */
  headRef: string;
  baseSha: string;
  /** The PR's base BRANCH name (e.g. 'main'). Empty when the payload omits it. */
  baseRef: string;
  /**
   * True when the PR head lives in a DIFFERENT repo than the base (a fork PR),
   * or when the head repo is unknown/deleted while the base repo is known
   * (conservative: treated as a fork). The purser only RETARGETS same-repo PRs.
   */
  isFork: boolean;
  /**
   * `pull_request.user.login` (e.g. `port-daddy[bot]`). Carried so the
   * self-review guard can ask WHO wrote this PR without a second API call.
   * Empty when GitHub omits it — which `classifyPrAuthorship` reads as
   * "not the fleet", the conservative direction for a review skip.
   */
  authorLogin: string;
  /**
   * `pull_request.user.type` — `Bot` for GitHub App authored PRs, `User` for
   * humans. The self-review guard requires `Bot`, so a human can never inherit
   * machine trust by naming their branch `purser/…`.
   */
  authorType: string;
  installationId: number;
  files: PRFile[];
  diff: string;
}

/**
 * Fork detection from the webhook payload's head/base repo full names.
 * Both absent (minimal test payloads) ⇒ same-repo. Head absent while base is
 * known (deleted fork repo) ⇒ conservative: fork.
 */
function computeIsFork(headRepoFullName: unknown, baseRepoFullName: unknown): boolean {
  const head = typeof headRepoFullName === 'string' ? headRepoFullName : null;
  const base = typeof baseRepoFullName === 'string' ? baseRepoFullName : null;
  if (head === null && base === null) return false;
  if (head === null || base === null) return true;
  return head !== base;
}

export async function fetchPRContext(
  owner: string,
  repo: string,
  prNumber: number,
  prPayload: Record<string, unknown>,
  token: string,
): Promise<PRContext> {
  const eventPr = prPayload as {
    number: number;
    title: string;
    body: string;
    user?: { login?: string; type?: string } | null;
    head: { sha: string; ref?: string; repo?: { full_name?: string } | null };
    base: { sha: string; ref?: string; repo?: { full_name?: string } | null };
  };

  const [prRes, filesRes, diffRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: ghHeaders(token),
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, {
      headers: ghHeaders(token),
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: { ...ghHeaders(token), Accept: 'application/vnd.github.v3.diff' },
    }),
  ]);

  if (!prRes.ok) {
    throw new Error(`fetch pull request failed ${prRes.status}: ${await prRes.text()}`);
  }
  const livePr = (await prRes.json()) as typeof eventPr;
  const files: PRFile[] = filesRes.ok ? ((await filesRes.json()) as PRFile[]) : [];
  const diff = diffRes.ok ? await diffRes.text() : '';

  return {
    owner,
    repo,
    prNumber,
    title: livePr.title ?? '',
    body: livePr.body ?? '',
    headSha: livePr.head?.sha ?? '',
    headRef: livePr.head?.ref ?? '',
    baseSha: livePr.base?.sha ?? '',
    baseRef: livePr.base?.ref ?? '',
    isFork: computeIsFork(livePr.head?.repo?.full_name, livePr.base?.repo?.full_name),
    // Authorship comes from the LIVE PR (same zero-trust posture as head.ref /
    // repo full_names above): the webhook payload is attacker-influenced in
    // ways the authoritative fetch is not, and this field gates the
    // self-review skip. Fall back to the event payload only when the live PR
    // omits it, so a minimal test payload still classifies.
    authorLogin: livePr.user?.login ?? eventPr.user?.login ?? '',
    authorType: livePr.user?.type ?? eventPr.user?.type ?? '',
    installationId: 0,
    files,
    diff,
  };
}

/**
 * Fetch a file's contents at a given ref.
 *
 * ZERO-TRUST INVARIANT (enforced by callers): `ref` for any config/contract
 * file MUST be the trusted default branch, NEVER `pull_request.head.sha`.
 * A PR that edits `pd-fleet.yml` or `fleet/ships/*.md` must not be able to
 * weaken its own gate. The ref travels as a query param so a malicious path
 * cannot smuggle a different ref.
 */
export async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (body.encoding !== 'base64' || !body.content) return null;
  return atob(body.content.replace(/\n/g, ''));
}

// ---------------------------------------------------------------------------
// Fleet-context helpers (Lookout's tools: cross-PR / cross-branch awareness)

export interface OpenPR {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
}

/**
 * List the repo's currently-open PRs (excluding `excludeNumber`, the PR under
 * review). Lookout uses this to spot cross-PR contradictions and duplication —
 * two branches building the same thing, or one PR that breaks another's
 * assumption. Best-effort: a failure returns [] (Lookout just loses that
 * context, never crashes the run).
 */
export async function fetchOpenPullRequests(
  owner: string,
  repo: string,
  token: string,
  excludeNumber: number,
  limit = 30,
): Promise<OpenPR[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{
      number: number;
      title: string;
      draft?: boolean;
      head?: { ref?: string };
      base?: { ref?: string };
    }>;
    return body
      .filter(p => p.number !== excludeNumber)
      .map(p => ({
        number: p.number,
        title: p.title ?? '',
        headRef: p.head?.ref ?? '',
        baseRef: p.base?.ref ?? '',
        draft: p.draft === true,
      }));
  } catch {
    return [];
  }
}

/**
 * List recently-updated branches (feature branches + worktree branches). Lookout
 * uses this to notice work-in-flight that isn't a PR yet. Best-effort: [] on
 * failure.
 */
export async function listRecentBranches(
  owner: string,
  repo: string,
  token: string,
  limit = 40,
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${Math.min(limit, 100)}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{ name?: string }>;
    return body.map(b => b.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build the "fleet context" block Lookout is given in its user message: the
 * other open PRs and recent feature/worktree branches. Rendered as compact
 * markdown so the model can reason about cross-PR contradiction and duplication.
 * Returns '' when there is nothing to report.
 */
export function renderFleetContext(openPRs: OpenPR[], branches: string[]): string {
  if (openPRs.length === 0 && branches.length === 0) return '';
  const parts: string[] = ['## Fleet context (other work in flight)'];
  if (openPRs.length) {
    parts.push('### Other open PRs');
    parts.push(
      openPRs
        .map(p => `- #${p.number}${p.draft ? ' (draft)' : ''}: ${p.title} [${p.headRef} → ${p.baseRef}]`)
        .join('\n'),
    );
  }
  if (branches.length) {
    parts.push('### Recent branches');
    parts.push(branches.map(b => `- ${b}`).join('\n'));
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Commenting

/** GitHub rejects issue-comment bodies longer than this (422). */
const GITHUB_COMMENT_MAX = 65536;

/**
 * Cap a comment body to GitHub's hard limit. A body that would 422 is truncated
 * with a marker, and the ship's machine tag is re-appended so edit-in-place
 * (which locates the comment by that tag) still works. Belt-and-suspenders: the
 * renderers already bound their output, but a pathological findings set (or the
 * raw-output fallback on a malformed block) must never fail the POST outright.
 */
function capBody(body: string, tag: string): string {
  if (body.length <= GITHUB_COMMENT_MAX) return body;
  const marker = `\n\n…truncated (exceeded GitHub's ${GITHUB_COMMENT_MAX}-char limit)\n\n${tag}`;
  // Pathological: a marker (dominated by `tag`) at/over the limit would make the
  // slice length <= 0 and could drop the edit-in-place tag. Fall back to a hard
  // slice that still preserves the tag at the very end.
  if (marker.length >= GITHUB_COMMENT_MAX) {
    return body.slice(0, Math.max(0, GITHUB_COMMENT_MAX - tag.length - 1)) + '\n' + tag;
  }
  return body.slice(0, GITHUB_COMMENT_MAX - marker.length) + marker;
}

export async function postShipComment(
  owner: string,
  repo: string,
  prNumber: number,
  shipHandle: string,
  shipRole: string,
  body: string,
  token: string,
): Promise<void> {
  if (!body.trim()) return;

  const tag = `<!-- pd-ship:${shipHandle} -->`;
  const commentBody = capBody(
    `**[pd-${shipHandle}]** ${shipRole}\n\n${body}\n\n${tag}`,
    tag,
  );

  // Look for an existing comment with our tag to edit in place (idempotent on
  // retry: the same deliveryId re-running edits, never duplicates).
  const existing = await findExistingComment(owner, repo, prNumber, shipHandle, token);

  if (existing) {
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing}`,
      {
        method: 'PATCH',
        headers: ghHeaders(token),
        body: JSON.stringify({ body: commentBody }),
      },
    );
  } else {
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({ body: commentBody }),
      },
    );
  }
}

async function findExistingComment(
  owner: string,
  repo: string,
  prNumber: number,
  shipHandle: string,
  token: string,
): Promise<number | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const comments = (await res.json()) as Array<{ id: number; body: string }>;
  const tag = `<!-- pd-ship:${shipHandle} -->`;
  const match = comments.find(c => c.body.includes(tag));
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Issues (fleet idea capture)

/**
 * Open a GitHub issue and return its number + html url. Used to durably capture
 * a novel (semantic-deduped) fleet idea so a Spark/Spider proposal doesn't
 * evaporate when the PR scrolls away. Labels are created on demand by GitHub if
 * they don't exist. Throws on a non-2xx so the caller's best-effort capture path
 * records an `error` rather than silently losing the idea.
 */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[],
  token: string,
): Promise<{ number: number; url: string }> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    throw new Error(`createIssue failed ${res.status}: ${await res.text()}`);
  }
  const j = (await res.json()) as { number: number; html_url: string };
  return { number: j.number, url: j.html_url };
}

// ---------------------------------------------------------------------------
// Reviews (inline comments)

export interface ReviewComment {
  /** File path relative to repo root. */
  path: string;
  /** 1-indexed line in the file (GitHub's review API expects `line`). */
  line: number;
  /** Comment text — already prefixed with `[<ship>] ` by the caller. */
  body: string;
}

/**
 * Create ONE GitHub Review carrying all the fleet's inline comments plus a
 * roll-up summary body. This is the PRIMARY review surface; per-ship issue
 * comments remain only for backward-compatible history.
 *
 * `event` is the review event ('COMMENT' — gating is owned by the check run, so
 * the review never REQUEST_CHANGES on its own). Inline comments use the modern
 * `line`/`side` fields against `commitSha` (the PR head SHA).
 *
 * Best-effort: a review failure NEVER throws — the merge gate is the check run,
 * not the review. (Idempotency caveat: GitHub has no clean PATCH for a whole
 * review-with-comments, so a re-run may append a second review; the per-ship
 * issue comments stay edit-in-place for the idempotent history surface.)
 */
export async function createReview(
  owner: string,
  repo: string,
  prNumber: number,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  summaryBody: string,
  comments: ReviewComment[],
  commitSha: string,
  token: string,
): Promise<{ reviewId: number }> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({
          commit_id: commitSha || undefined,
          event,
          body: summaryBody,
          comments: comments.map(c => ({
            path: c.path,
            line: c.line,
            side: 'RIGHT',
            body: c.body,
          })),
        }),
      },
    );
    if (!res.ok) return { reviewId: 0 };
    const body = (await res.json()) as { id?: number };
    return { reviewId: body.id ?? 0 };
  } catch {
    return { reviewId: 0 };
  }
}

// ---------------------------------------------------------------------------
// Check runs

export async function createCheckRun(
  owner: string,
  repo: string,
  name: string,
  headSha: string,
  token: string,
  detailsUrl?: string | null,
): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      name,
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
    }),
  });
  if (!res.ok) return 0;
  const body = (await res.json()) as { id: number };
  return body.id ?? 0;
}

export async function completeCheckRun(
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  token: string,
  detailsUrl?: string | null,
): Promise<void> {
  if (!checkRunId) return;
  // details_url is (re)stamped on completion too, so a run that REUSED an
  // older check run (idempotent retry path) still links to its own page.
  await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output: { title: 'Port Daddy Fleet', summary },
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
    }),
  });
}

/**
 * Find an existing in-progress/queued 'Port Daddy Fleet' check run for a head
 * SHA. Used for idempotency: a retried delivery must reuse the same check run
 * rather than spawning a second one.
 */
export async function findFleetCheckRun(
  owner: string,
  repo: string,
  headSha: string,
  name: string,
  token: string,
): Promise<number | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { check_runs?: Array<{ id: number; name: string }> };
  const match = (body.check_runs ?? []).find(c => c.name === name);
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Fleet self-identity + the steward's GitHub surface

/** KV key holding the resolved `<app-slug>[bot]` login. */
const APP_LOGIN_KEY = 'fleet_app_login';
/** Cache the App slug for a day — it changes only if the App is renamed. */
const APP_LOGIN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Resolve THIS App's bot login (`<app-slug>[bot]`), KV-cached.
 *
 * PURPOSE / DESIGN: the self-review skip and the steward's merge gate both need
 * to know which GitHub account IS the fleet. Hard-coding `port-daddy[bot]`
 * would silently mis-identify every other tenant's installation, and reading it
 * from the webhook payload would let the thing being judged supply the judge's
 * identity. Instead we ask GitHub, under our OWN App JWT, what App these
 * credentials belong to — a value no PR can influence.
 *
 * FAIL DIRECTION: returns `null` rather than throwing or guessing. `null`
 * degrades the authorship classification to a weak signal, which the steward
 * treats as a hard stop (never merges) while the review skip may still accept
 * it. An identity we could not confirm must never unlock a merge.
 *
 * @param appId The GitHub App id (numeric string).
 * @param privateKeyPem PEM private key used to mint the App JWT.
 * @param kv Token-cache namespace, reused for the day-long slug cache.
 * @returns `<slug>[bot]`, or `null` when it could not be determined.
 */
export async function resolveFleetAppLogin(
  appId: string,
  privateKeyPem: string,
  kv: KVNamespace,
): Promise<string | null> {
  try {
    const cached = await kv.get(APP_LOGIN_KEY);
    if (cached) return cached;
  } catch {
    /* cache read failure is not fatal — fall through to the API */
  }
  try {
    const jwt = await mintAppJwt(appId, privateKeyPem);
    const res = await fetch('https://api.github.com/app', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'port-daddy-fleet/1.0',
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { slug?: string };
    if (!body.slug) return null;
    const login = `${body.slug}[bot]`;
    await kv.put(APP_LOGIN_KEY, login, { expirationTtl: APP_LOGIN_TTL_SECONDS }).catch(() => {});
    return login;
  } catch {
    return null;
  }
}

/** One check/status context as reported by the status-check rollup. */
export interface CheckContext {
  name: string;
  /** QUEUED | IN_PROGRESS | COMPLETED for check runs; '' for legacy statuses. */
  status: string;
  /** SUCCESS | FAILURE | NEUTRAL | SKIPPED | CANCELLED | … or '' when pending. */
  conclusion: string;
}

/** One review thread, flattened for the steward's dispute logic. */
export interface ReviewThread {
  /** GraphQL node id (unused today; kept so a future resolve-thread call can). */
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  comments: Array<{
    /** REST comment id — the reply endpoint keys on this, not the node id. */
    databaseId: number | null;
    body: string;
    authorLogin: string;
  }>;
}

/** Everything the steward needs about a PR, from ONE GraphQL round trip. */
export interface StewardPrSnapshot {
  number: number;
  title: string;
  /** The PR's markdown body — the base the steward appends its changelog to. */
  body: string;
  isDraft: boolean;
  /** OPEN | CLOSED | MERGED. */
  state: string;
  /** MERGEABLE | CONFLICTING | UNKNOWN. `UNKNOWN` is a refusal, not a maybe. */
  mergeable: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  authorLogin: string;
  /** `Bot` | `User` | `Organization`, derived from the GraphQL `__typename`. */
  authorType: string;
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (none required). */
  reviewDecision: string;
  changedFiles: string[];
  checks: CheckContext[];
  /** True when the rollup was absent — "no checks reported", not "all green". */
  checksReported: boolean;
  threads: ReviewThread[];
}

const STEWARD_PR_QUERY = `
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      number title body isDraft state mergeable reviewDecision
      headRefName baseRefName
      author { login __typename }
      files(first:100){ nodes { path } }
      reviewThreads(first:50){ nodes {
        id isResolved isOutdated path
        comments(first:20){ nodes { databaseId body author { login } } }
      } }
      commits(last:1){ nodes { commit {
        oid
        statusCheckRollup { contexts(first:100){ nodes {
          __typename
          ... on CheckRun { name status conclusion }
          ... on StatusContext { context state }
        } } }
      } } }
    }
  }
}`;

interface RawContextNode {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  context?: string;
  state?: string;
}

/** Normalize a check-run node OR a legacy commit-status node to one shape. */
function normalizeContext(node: RawContextNode): CheckContext {
  if (node.__typename === 'StatusContext') {
    // Legacy statuses have no separate status/conclusion: PENDING is pending,
    // everything else is terminal. Mapping PENDING to an empty conclusion keeps
    // the pending check in `evaluateMerge` uniform across both node types.
    const state = (node.state ?? '').toUpperCase();
    return {
      name: node.context ?? '(status)',
      status: state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
      conclusion: state === 'PENDING' ? '' : state,
    };
  }
  return {
    name: node.name ?? '(check)',
    status: (node.status ?? '').toUpperCase(),
    conclusion: (node.conclusion ?? '').toUpperCase(),
  };
}

/**
 * Fetch the steward's complete view of a PR in one GraphQL request.
 *
 * DESIGN / MOTIVATION: the merge decision reads eight facts (draft, state,
 * mergeability, author identity, review decision, changed files, check rollup,
 * review-thread resolution). Fetching them across eight REST calls would make
 * the decision non-atomic — checks could go green between the "is it draft"
 * call and the "are checks green" call — and thread resolution is not exposed
 * by REST at all. One query is both cheaper and closer to a consistent
 * snapshot, which is what a fail-closed gate wants.
 *
 * Returns `null` on ANY transport/shape failure rather than a partial object:
 * the steward's contract is "if I cannot determine a precondition, I do not
 * merge", and a half-populated snapshot is exactly how that promise gets broken.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param prNumber PR to inspect.
 * @param token Installation access token.
 * @returns The snapshot, or `null` when it could not be established.
 */
export async function fetchStewardPrSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<StewardPrSnapshot | null> {
  let raw: unknown;
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({
        query: STEWARD_PR_QUERY,
        variables: { owner, repo, number: prNumber },
      }),
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  const pr = (raw as { data?: { repository?: { pullRequest?: Record<string, unknown> } } })?.data
    ?.repository?.pullRequest;
  if (!pr || typeof pr !== 'object') return null;

  const author = (pr.author ?? {}) as { login?: string; __typename?: string };
  const files = ((pr.files as { nodes?: Array<{ path?: string }> } | undefined)?.nodes ?? [])
    .map(n => n?.path ?? '')
    .filter(Boolean);

  const commitNode = ((pr.commits as { nodes?: Array<{ commit?: Record<string, unknown> }> })
    ?.nodes ?? [])[0]?.commit;
  const rollup = commitNode?.statusCheckRollup as
    | { contexts?: { nodes?: RawContextNode[] } }
    | null
    | undefined;
  const contextNodes = rollup?.contexts?.nodes ?? null;

  const threads = (
    (pr.reviewThreads as { nodes?: Array<Record<string, unknown>> } | undefined)?.nodes ?? []
  ).map(t => ({
    id: String(t.id ?? ''),
    isResolved: t.isResolved === true,
    isOutdated: t.isOutdated === true,
    path: String(t.path ?? ''),
    comments: (
      (t.comments as { nodes?: Array<Record<string, unknown>> } | undefined)?.nodes ?? []
    ).map(c => ({
      databaseId: typeof c.databaseId === 'number' ? c.databaseId : null,
      body: String(c.body ?? ''),
      authorLogin: String((c.author as { login?: string } | null)?.login ?? ''),
    })),
  }));

  return {
    number: typeof pr.number === 'number' ? pr.number : prNumber,
    title: String(pr.title ?? ''),
    body: String(pr.body ?? ''),
    isDraft: pr.isDraft === true,
    state: String(pr.state ?? '').toUpperCase(),
    mergeable: String(pr.mergeable ?? 'UNKNOWN').toUpperCase(),
    headSha: String(commitNode?.oid ?? ''),
    headRef: String(pr.headRefName ?? ''),
    baseRef: String(pr.baseRefName ?? ''),
    authorLogin: String(author.login ?? ''),
    // GraphQL exposes the actor's concrete type; `Bot` is the App-authored case.
    authorType: String(author.__typename ?? ''),
    reviewDecision: String(pr.reviewDecision ?? '').toUpperCase(),
    changedFiles: files,
    checks: (contextNodes ?? []).map(normalizeContext),
    checksReported: Array.isArray(contextNodes) && contextNodes.length > 0,
    threads,
  };
}

/**
 * Reply inside an existing review thread.
 *
 * PURPOSE: the purser's own test-PR body says "Dispute a test here, with
 * reasons, if it misreads the contract." Honoring that invitation requires a
 * surface for the machine to ANSWER on the thread where the dispute was raised,
 * not in a detached top-level comment a reviewer will never see in context.
 *
 * Best-effort by design: a failed reply must not become a merge. The caller
 * refuses to merge on an unresolved dispute regardless of whether the reply
 * landed, so returning `false` degrades to "stayed silent AND stayed blocked",
 * never to "merged anyway".
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param prNumber The PR carrying the thread.
 * @param commentId REST id of the thread's FIRST comment (the thread root).
 * @param body Markdown reply text.
 * @param token Installation access token.
 * @returns `true` when GitHub accepted the reply.
 */
export async function replyToReviewThread(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
      { method: 'POST', headers: ghHeaders(token), body: JSON.stringify({ body }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** How a head branch relates to its base, from the compare API. */
export interface BranchComparison {
  /** Commits on the base that the head does not have. `>0` ⇒ the PR is stale. */
  behindBy: number;
  /** Commits on the head that the base does not have. */
  aheadBy: number;
  /** `behind` | `ahead` | `identical` | `diverged`. */
  status: string;
}

/**
 * Compare a PR's base branch to its head to learn whether the PR is stale.
 *
 * WHY THE COMPARE API AND NOT `mergeStateStatus`: GraphQL's `mergeStateStatus`
 * only reports `BEHIND` when the repository's branch protection REQUIRES
 * up-to-date branches; on a repo without that rule a badly stale PR reports
 * `CLEAN`, and the steward would never refresh anything. `behind_by` from the
 * compare endpoint is a fact about the commit graph, independent of policy, and
 * needs no preview header.
 *
 * Returns `null` on any failure — "I could not determine staleness" must not be
 * confused with "it is fresh", because the caller's next move is a write.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param base Base branch name (e.g. `main`).
 * @param head Head branch name (e.g. `purser/pr-4763-tests`).
 * @param token Installation access token.
 * @returns The comparison, or `null` when it could not be established.
 */
export async function compareBranches(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token: string,
): Promise<BranchComparison | null> {
  if (!base || !head) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      behind_by?: number;
      ahead_by?: number;
      status?: string;
    };
    if (typeof body.behind_by !== 'number') return null;
    return {
      behindBy: body.behind_by,
      aheadBy: typeof body.ahead_by === 'number' ? body.ahead_by : 0,
      status: String(body.status ?? ''),
    };
  } catch {
    return null;
  }
}

/** Outcome of a branch-update attempt, with enough detail to be honest about it. */
export interface UpdateBranchOutcome {
  updated: boolean;
  status: number;
  detail: string;
  /**
   * True when GitHub refused because merging the base would CONFLICT. The
   * steward reports this and stops; it never invents a resolution.
   */
  conflicted: boolean;
}

/**
 * Merge the base branch into a PR's head — GitHub's "Update branch" button.
 *
 * PURPOSE: a fleet-authored PR can sit behind `main` until a conflict surfaces
 * at the worst moment. Keeping the machine's own branches current is friction
 * the machine should absorb. `expected_head_sha` pins the operation to the
 * commit the steward evaluated, so a concurrent push turns this into a 422
 * rather than a write against a branch that changed underneath us.
 *
 * CONFLICTS ARE NOT OURS TO RESOLVE. GitHub answers 422 when the merge would
 * conflict; that is surfaced as `conflicted: true` and nothing else happens. An
 * agent guessing at a conflict resolution is an agent silently authoring code
 * nobody asked for, in the one situation where two humans already disagreed
 * about the same lines.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param prNumber PR whose head branch should be refreshed.
 * @param expectedHeadSha The head commit the caller evaluated.
 * @param token Installation access token.
 * @returns Whether the branch was updated, and whether it conflicted.
 */
export async function updatePullRequestBranch(
  owner: string,
  repo: string,
  prNumber: number,
  expectedHeadSha: string,
  token: string,
): Promise<UpdateBranchOutcome> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/update-branch`,
      {
        method: 'PUT',
        headers: ghHeaders(token),
        body: JSON.stringify({ expected_head_sha: expectedHeadSha }),
      },
    );
    const detail = (await res.text()).slice(0, 300);
    return {
      updated: res.ok,
      status: res.status,
      detail,
      conflicted: res.status === 422 && /conflict/i.test(detail),
    };
  } catch (err) {
    return { updated: false, status: 0, detail: String(err).slice(0, 300), conflicted: false };
  }
}

/**
 * Replace a pull request's body.
 *
 * SCOPE WARNING, enforced by the caller: this must only ever be pointed at a
 * PR the fleet itself authored. Rewriting a human's description is not a
 * convenience, it is vandalism of their words — `steward.ts#refreshFleetPrBody`
 * asserts fleet authorship immediately before calling this and throws
 * otherwise.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param prNumber PR to edit.
 * @param body The complete new markdown body.
 * @param token Installation access token.
 * @returns True when GitHub accepted the edit.
 */
export async function updatePullRequestBody(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: ghHeaders(token),
      body: JSON.stringify({ body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Outcome of a merge attempt — never a bare boolean, so refusals stay legible. */
export interface MergeOutcome {
  merged: boolean;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  /** GitHub's message, truncated for the transcript. */
  detail: string;
}

/**
 * Merge a pull request, pinned to an expected head SHA.
 *
 * WHY THE SHA IS MANDATORY: every precondition the steward checked (green
 * checks, no disputes, no guardrail files in the diff) was evaluated against a
 * SPECIFIC commit. If someone pushes between the evaluation and this call, all
 * of those findings describe code that is no longer there. Passing `sha` makes
 * GitHub itself reject the merge with 409 in that race, so the steward cannot
 * merge a diff it never examined. This is the last line of the fail-closed
 * argument and it is enforced server-side, not by our own bookkeeping.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param prNumber PR to merge.
 * @param sha The exact head commit the preconditions were evaluated against.
 * @param method Merge strategy (`squash` keeps machine branches to one commit).
 * @param token Installation access token.
 * @returns Whether GitHub merged, with the status and message for the transcript.
 */
export async function mergePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  sha: string,
  method: 'merge' | 'squash' | 'rebase',
  token: string,
): Promise<MergeOutcome> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        headers: ghHeaders(token),
        body: JSON.stringify({ sha, merge_method: method }),
      },
    );
    const detail = (await res.text()).slice(0, 300);
    return { merged: res.ok, status: res.status, detail };
  } catch (err) {
    return { merged: false, status: 0, detail: String(err).slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'port-daddy-fleet/1.0',
  };
}
