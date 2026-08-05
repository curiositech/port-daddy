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
// Fleet self-identity

/** KV key holding the resolved `<app-slug>[bot]` login. */
const APP_LOGIN_KEY = 'fleet_app_login';
/** Cache the App slug for a day — it changes only if the App is renamed. */
const APP_LOGIN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Resolve THIS App's bot login (`<app-slug>[bot]`), KV-cached.
 *
 * PURPOSE / DESIGN: the self-review skip (src/execute.ts, via
 * `classifyPrAuthorship` in src/fleet-identity.ts) needs to know which GitHub
 * account IS the fleet, so it can tell a fleet-authored branch apart from a
 * human's. Hard-coding `port-daddy[bot]` would silently mis-identify every
 * other tenant's installation, and reading it from the webhook payload would
 * let the thing being judged supply the judge's identity. Instead we ask
 * GitHub, under our OWN App JWT, what App these credentials belong to — a
 * value no PR can influence.
 *
 * FAIL DIRECTION: returns `null` rather than throwing or guessing. `null`
 * degrades the authorship classification to the weaker `bot-and-branch`
 * signal (see `classifyPrAuthorship`), which the review skip may still accept
 * — the cost of a false positive there is one unreviewed machine branch, not
 * an unmerged human PR.
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
