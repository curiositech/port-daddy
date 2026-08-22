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

/**
 * Page size for the PR `/files` endpoint.
 *
 * Exported because anything reasoning about whether the changed-file list is
 * COMPLETE must compare against the same number this fetch uses. Hard-coding it
 * in two places lets the truncation logic drift silently the moment either side
 * changes, and a wrong answer there means real findings get dropped.
 *
 * This call does not paginate, so a PR at or above this many files yields a
 * TRUNCATED list that must be treated as incomplete rather than authoritative.
 */
export const PR_FILES_PAGE_SIZE = 100;

/**
 * Hard ceiling on the raw unified diff we will hold in memory (#7743).
 *
 * WHY THIS EXISTS: `await res.text()` on GitHub's diff endpoint is unbounded,
 * and a Worker has 128MB. A PR that regenerates a lockfile, vendors a
 * dependency, or commits generated output can return a diff far larger than
 * that, and the read dies with `exceededMemory` before any catchable error can
 * be thrown — which is exactly the signature the dead-letters showed: ~80s of
 * wall clock, under a second of CPU, no exception. Reading bytes off a socket
 * costs almost no CPU, so an OOM with a flat CPU line means a large body, not
 * heavy computation.
 *
 * WHY 2MB IS NOT A LOSS: the executor already truncates review input to
 * MAX_MAP_CHUNKS_PER_SHIP × the chunk ceiling (~384KB) before it calls a
 * model. Everything past that was being downloaded, parsed, and then thrown
 * away. This cap discards the same bytes earlier, before they can kill the
 * isolate.
 */
export const MAX_DIFF_BYTES = 2_000_000;

/**
 * Ceiling on the `/files` JSON body.
 *
 * Separate from {@link MAX_DIFF_BYTES} and deliberately larger: this payload
 * repeats every file's `patch` inside JSON envelopes, so it runs bigger than
 * the raw diff for the same change — and both are fetched CONCURRENTLY, so the
 * peak is their sum. Bounding only one of them would leave the other able to
 * exhaust the isolate on its own.
 */
export const MAX_FILES_BYTES = 4_000_000;

/** What a bounded body read actually consumed. */
export interface CappedRead {
  /** The decoded text, at most `maxBytes` of source bytes. */
  text: string;
  /** Bytes actually read (equals the cap when truncated). */
  bytes: number;
  /** True when the body was longer than the cap and the rest was discarded. */
  truncated: boolean;
}

/**
 * Read a response body into text, refusing to exceed `maxBytes`.
 *
 * DESIGN: streams and stops, rather than buffering then trimming — trimming
 * after the fact would require the whole body to exist in memory first, which
 * is the very failure this prevents. The reader is cancelled on the way out so
 * the connection is not left draining a body nobody will read.
 *
 * Truncation can land mid-UTF-8; `TextDecoder` emits a replacement character
 * there, which is harmless for diff text and strictly better than an OOM.
 *
 * @param res - The response whose body to read.
 * @param maxBytes - Hard ceiling on bytes consumed.
 * @returns The text plus how much was read and whether it was cut short.
 */
export async function readTextCapped(res: Response, maxBytes: number): Promise<CappedRead> {
  const body = res.body;
  // No stream (some fakes, and empty bodies): fall back, but still bound it.
  if (!body) {
    const whole = await res.text();
    const encoded = new TextEncoder().encode(whole);
    if (encoded.byteLength <= maxBytes) {
      return { text: whole, bytes: encoded.byteLength, truncated: false };
    }
    return {
      text: new TextDecoder().decode(encoded.subarray(0, maxBytes)),
      bytes: maxBytes,
      truncated: true,
    };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - bytes));
        bytes = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder().decode(joined), bytes, truncated };
}

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
  /**
   * `pull_request.state` from the LIVE PR — `open` or `closed`.
   *
   * Carried so the fleet can decline to review a PR that is already over. The
   * queue can deliver a job long after it was enqueued (retry, backlog drain,
   * an executor outage), so the state at enqueue time is not the state now.
   * Empty when GitHub omits it, which {@link classifyPrLifecycle} reads as
   * "still open" — the fail-open direction for a review gate.
   */
  state: string;
  /**
   * `pull_request.merged` from the LIVE PR. Checked ahead of {@link state}
   * because GitHub reports a merged PR as `closed`, and a purser test branch
   * stacked under an already-merged PR can never be merged through.
   */
  merged: boolean;
  installationId: number;
  files: PRFile[];
  diff: string;
  /**
   * Bytes of raw diff actually read (capped at {@link MAX_DIFF_BYTES}).
   *
   * INSTRUMENTATION, deliberately on the context rather than in a log line:
   * #7743 cost two investigation cycles because a platform kill leaves no
   * catchable error and nothing recorded the input size. Carrying the measured
   * size forward means the transcript can state it on every run, so the next
   * memory incident is self-diagnosing the way the delivery-attempt markers
   * made the dead-letters self-diagnosing.
   */
  diffBytes: number;
  /** True when the diff exceeded the cap and was cut short. */
  diffTruncated: boolean;
  /** True when the `/files` body exceeded its cap or failed to parse. */
  filesTruncated: boolean;
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
    state?: string;
    merged?: boolean;
    head: { sha: string; ref?: string; repo?: { full_name?: string } | null };
    base: { sha: string; ref?: string; repo?: { full_name?: string } | null };
  };

  const [prRes, filesRes, diffRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: ghHeaders(token),
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PR_FILES_PAGE_SIZE}`, {
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

  // Both bodies are bounded (#7743). They arrive concurrently, so the peak is
  // their sum; an unbounded read of either one can kill the isolate before any
  // catch block exists to report it.
  let files: PRFile[] = [];
  let filesTruncated = false;
  if (filesRes.ok) {
    const read = await readTextCapped(filesRes, MAX_FILES_BYTES);
    if (read.truncated) {
      // A truncated body is not parseable JSON. Degrade to "no file list"
      // rather than throwing: the ships review the diff, and the mediator's
      // line-mapping simply falls back. Silent would be worse than empty, so
      // the flag rides along on the context.
      filesTruncated = true;
    } else {
      try {
        files = JSON.parse(read.text) as PRFile[];
      } catch {
        filesTruncated = true;
      }
    }
  }

  const diffRead = diffRes.ok
    ? await readTextCapped(diffRes, MAX_DIFF_BYTES)
    : { text: '', bytes: 0, truncated: false };
  const diff = diffRead.text;

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
    // Lifecycle from the LIVE PR ONLY — never the event payload. The webhook
    // describes the PR as it was when the job was ENQUEUED; this gate exists
    // precisely because that can differ from now, so falling back to the event
    // would reintroduce the bug it prevents. Absent ⇒ '' / false ⇒ fail open.
    state: typeof livePr.state === 'string' ? livePr.state : '',
    merged: livePr.merged === true,
    installationId: 0,
    files,
    diff,
    diffBytes: diffRead.bytes,
    diffTruncated: diffRead.truncated,
    filesTruncated,
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

/** One open PR with the fields the MEDIATOR needs (src/mediator.ts). */
export interface OpenPRDetailed {
  number: number;
  title: string;
  /** PR author's GitHub login (claim identity for the conflict parley). */
  author: string;
  /** unix seconds — decides CLAIM order (earlier-created = first claimant). */
  createdAt: number;
  /** unix seconds — the recency the pair cap prioritizes by. */
  updatedAt: number;
  /** Head SHA the neutral check run posts against. */
  headSha: string;
  draft: boolean;
}

/**
 * List the repo's open PRs WITH author/timestamps/head — the mediator's view.
 *
 * Separate from {@link fetchOpenPullRequests} (Lookout's slimmer shape) on
 * purpose: Lookout's callers and prompt renderer depend on the exact OpenPR
 * shape, and widening it for the mediator would couple two features that
 * merely share an endpoint. Sorted by GitHub `updated desc`, which IS the
 * recency prioritization the pair cap consumes — the first N entries are the
 * N most recently active PRs. Best-effort: [] on any failure.
 */
export async function fetchOpenPullRequestsDetailed(
  owner: string,
  repo: string,
  token: string,
  limit = 100,
): Promise<OpenPRDetailed[]> {
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
      user?: { login?: string };
      created_at?: string;
      updated_at?: string;
      head?: { sha?: string };
    }>;
    const toUnix = (s: string | undefined): number => {
      const ms = s ? Date.parse(s) : NaN;
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
    };
    return body.map((p) => ({
      number: p.number,
      title: p.title ?? '',
      author: p.user?.login ?? '',
      createdAt: toUnix(p.created_at),
      updatedAt: toUnix(p.updated_at),
      headSha: p.head?.sha ?? '',
      draft: p.draft === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch one PR's changed files WITH patches — the mediator's symbol source.
 *
 * One page only ({@link PR_FILES_PAGE_SIZE}), same truncation stance as the
 * main PR-context fetch: a 100+-file PR yields a PARTIAL symbol set, which
 * can only produce FEWER predicted collisions, never invented ones — the
 * conservative direction for a feature that convenes people. Best-effort:
 * [] on any failure.
 */
export async function fetchPRFilePatches(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<Array<{ filename: string; patch?: string }>> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PR_FILES_PAGE_SIZE}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{ filename?: string; patch?: string }>;
    return body
      .filter((f): f is { filename: string; patch?: string } => typeof f.filename === 'string')
      .map((f) => (f.patch === undefined ? { filename: f.filename } : { filename: f.filename, patch: f.patch }));
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
// PR body sections (the PR summary as a fleet-maintained record)

/** GitHub rejects PR bodies longer than this (422), same cap as comments. */
const GITHUB_PR_BODY_MAX = 65536;

/**
 * Upsert a marked section into a pull request's BODY — the PR summary.
 *
 * MOTIVATION / DESIGN: the PR summary is the durable chronology of what a PR
 * is supposed to be; comments scroll away, check runs expire, but the body is
 * what every future reader (and every PR-requirements gate) reads first. When
 * the fleet derives something that IS that chronology — the purser's
 * steel-manned contract and its obligations (operator mandate, 2026-08-19) —
 * it belongs in the body, maintained by an agent, not buried in a comment.
 *
 * Idempotent edit-in-place: the section lives between `startMarker` and
 * `endMarker` (HTML comments, invisible in rendered markdown). Present ⇒
 * replaced; absent ⇒ appended. The rest of the body — the author's own words —
 * is never touched, and a body that would exceed GitHub's hard cap is left
 * alone entirely rather than truncating a human's prose.
 *
 * @param owner Repo owner.
 * @param repo Repo name.
 * @param prNumber The PR whose body carries the section.
 * @param startMarker Opening HTML-comment marker (must be unique per section).
 * @param endMarker Closing HTML-comment marker.
 * @param section The markdown to place between the markers.
 * @param token Installation token (needs `pull_requests: write`).
 * @returns true when the body already carried the section or the PATCH landed;
 *   false on any fetch/PATCH failure or cap overflow — the caller records the
 *   outcome in the transcript so a silent miss is impossible.
 */
export async function upsertPrBodySection(
  owner: string,
  repo: string,
  prNumber: number,
  startMarker: string,
  endMarker: string,
  section: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: ghHeaders(token),
    });
    if (!res.ok) return false;
    const pr = (await res.json()) as { body?: string | null };
    const current = pr.body ?? '';
    const block = `${startMarker}\n${section}\n${endMarker}`;
    const startIdx = current.indexOf(startMarker);
    const endIdx = current.indexOf(endMarker);
    const bothAbsent = startIdx === -1 && endIdx === -1;
    const wellFormedPair = startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx;
    // A body carrying only ONE of the markers, or the pair inverted, is a
    // corrupted section (someone hand-edited it). Appending here would plant a
    // duplicate marker, and the NEXT replace would then span from the orphan
    // to the far marker — swallowing whatever author prose sat between them.
    // Refuse instead; the caller transcripts the miss loudly.
    if (!bothAbsent && !wellFormedPair) return false;
    const next = wellFormedPair
      ? current.slice(0, startIdx) + block + current.slice(endIdx + endMarker.length)
      : current.trimEnd()
        ? `${current.trimEnd()}\n\n${block}`
        : block;
    if (next === current) return true; // already up to date — no write needed
    if (next.length > GITHUB_PR_BODY_MAX) return false; // never truncate a human's body
    const patch = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: ghHeaders(token),
      body: JSON.stringify({ body: next }),
    });
    return patch.ok;
  } catch {
    return false;
  }
}

/**
 * Find an OPEN issue whose title starts with `titlePrefix`.
 *
 * MOTIVATION: the adjudicator (src/adjudicator.ts) tracks each fleet-wide
 * broken-ship fault as exactly ONE issue — the dedupe key is a stable title
 * prefix, so re-declaring the same epidemic on every affected run refreshes
 * nothing and spams nobody. Listing is scoped by state to keep the scan small;
 * a closed issue deliberately does NOT match, so a fault that recurs after a
 * fix gets a fresh issue (and a fresh page) rather than resurrecting history.
 *
 * @param owner Repo owner.
 * @param repo Repo name.
 * @param titlePrefix The stable title prefix to match (exact, case-sensitive).
 * @param token Installation token.
 * @returns The first matching open issue's number, or null (including on any
 *   fetch failure — the caller then creates a fresh issue, which at worst
 *   duplicates once rather than ever losing the tracking issue).
 */
export async function findOpenIssueByTitlePrefix(
  owner: string,
  repo: string,
  titlePrefix: string,
  token: string,
): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return null;
    const issues = (await res.json()) as Array<{ number?: number; title?: string; pull_request?: unknown }>;
    for (const issue of issues) {
      if (issue.pull_request) continue; // /issues lists PRs too — skip them
      if (typeof issue.title === 'string' && issue.title.startsWith(titlePrefix)) {
        return typeof issue.number === 'number' ? issue.number : null;
      }
    }
    return null;
  } catch {
    return null;
  }
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

/**
 * Complete a check run. Returns whether the PATCH actually succeeded — unlike
 * the old fire-and-forget version, a failure here is never silently
 * swallowed.
 *
 * The completion PATCH is retried locally (bounded, with backoff) on a
 * transient failure (network blip, GitHub 5xx, rate limit) because it is a
 * pure idempotent write. Failure is logged internally on every attempt and on
 * final exhaustion; this function returns false rather than throwing so each
 * caller can apply its own lifecycle policy. The Fleet executor treats false
 * as a queue-level failure after ship checkpoints are durable and before the
 * non-idempotent aggregate review is posted. Redelivery therefore resumes
 * without AI re-spend or duplicate reviews, while the DLQ remains able to
 * resolve a persistently lost required check honestly.
 */
export async function completeCheckRun(
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  token: string,
  detailsUrl?: string | null,
  title = 'Port Daddy Fleet',
): Promise<boolean> {
  if (!checkRunId) return false;
  // details_url is (re)stamped on completion too, so a run that REUSED an
  // older check run (idempotent retry path) still links to its own page.
  const body = JSON.stringify({
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    output: { title, summary },
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
  });
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(250 * (attempt - 1));
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
        method: 'PATCH',
        headers: ghHeaders(token),
        body,
      });
    } catch (err) {
      console.error(
        `[fleet-executor] completeCheckRun network error attempt=${attempt}/${MAX_ATTEMPTS} check=${checkRunId}: ${String(err)}`,
      );
      continue;
    }
    if (res.ok) return true;
    console.error(
      `[fleet-executor] completeCheckRun PATCH failed attempt=${attempt}/${MAX_ATTEMPTS} check=${checkRunId} status=${res.status}`,
    );
  }
  console.error(
    `[fleet-executor] completeCheckRun EXHAUSTED retries for check=${checkRunId} owner=${owner} repo=${repo} — ` +
      'check will remain in_progress until a future run reuses/DLQ-completes it (findFleetCheckRun idempotency path).',
  );
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const body = (await res.json()) as {
    check_runs?: Array<{ id: number; name: string; status?: string; conclusion?: string | null }>;
  };
  const match = (body.check_runs ?? []).find(c => c.name === name);
  return match?.id ?? null;
}

/**
 * The fleet check run for a head SHA, WITH its status -- the id alone cannot
 * answer "has this already been decided?".
 *
 * Why that question matters: a queue redelivery re-runs the whole fleet from
 * scratch. Comment posting is idempotent (edited in place), but the MODEL CALLS
 * are not -- the ship is re-run to produce the comment it then overwrites. When
 * the check has already been COMPLETED, that spend buys nothing at all: the
 * gate is resolved and a finished check run cannot be reopened, so the work
 * cannot even change the answer.
 *
 * Observed on 2026-08-06: runs exceeding the Worker wall-clock were redelivered
 * up to `max_retries` times, dead-lettered, completed as `failure` by the DLQ
 * handler -- and ships kept re-running and re-posting for hours afterwards
 * against a gate that could never go green.
 *
 * @param owner repository owner
 * @param repo repository name
 * @param headSha the PR head commit
 * @param name the check-run name to look for
 * @param token an installation token
 * @returns the check run's id and status, or null when absent/unreadable
 */
export async function findFleetCheckRunState(
  owner: string,
  repo: string,
  headSha: string,
  name: string,
  token: string,
): Promise<{ id: number; status: string; conclusion: string | null; summary: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    check_runs?: Array<{
      id: number;
      name: string;
      status?: string;
      conclusion?: string | null;
      output?: { summary?: string | null } | null;
    }>;
  };
  const match = (body.check_runs ?? []).find(c => c.name === name);
  if (!match) return null;
  // `summary` comes back on the list endpoint and carries the DLQ handler's
  // dead-letter marker, which is how the caller tells a gate that ships decided
  // apart from one a lost job failed — see dead-letter-marker.ts.
  return {
    id: match.id,
    status: match.status ?? '',
    conclusion: match.conclusion ?? null,
    summary: match.output?.summary ?? '',
  };
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
