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
  /** Exact live repository identities underlying {@link isFork}. */
  headRepoFullName?: string;
  baseRepoFullName?: string;
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
  /**
   * True when the changed-file inventory is incomplete or untrustworthy.
   *
   * GitHub's non-paginated first page is capped at {@link PR_FILES_PAGE_SIZE},
   * so an exactly-full page is deliberately treated as incomplete too: a 101st
   * sensitive path must never disappear behind a surface gate.
   */
  filesTruncated: boolean;
}

/** Small live witness used at mutation/checkpoint boundaries without reloading diff/files. */
export interface PullRequestMetadataWitness {
  title: string;
  body: string;
  headSha: string;
  headRef: string;
  headRepoFullName: string;
  baseSha: string;
  baseRef: string;
  baseRepoFullName: string;
  state: string;
  merged: boolean;
}

/**
 * GitHub failed to provide the authoritative raw patch for a pull request.
 *
 * A raw diff is review evidence, not an optional display convenience: treating
 * an HTTP failure as an empty string lets a ship manufacture a clean verdict
 * without having seen the change. The queue boundary deliberately receives a
 * typed error so it can retry this transient dependency and, after exhaustion,
 * let the DLQ complete the required Fleet check as infrastructure failure.
 *
 * @param status The GitHub HTTP status returned by the raw-diff endpoint.
 */
export class PullRequestDiffFetchError extends Error {
  constructor(readonly status: number) {
    super(`fetch pull request raw diff failed ${status}`);
    this.name = 'PullRequestDiffFetchError';
  }
}

/**
 * A fail-closed current-head check used immediately before model work and
 * GitHub mutations. `changed` is a normal supersession outcome; `unavailable`
 * is infrastructure failure and must retry rather than publish against an
 * unverified head.
 */
export class PullRequestHeadValidationError extends Error {
  constructor(
    readonly kind: 'changed' | 'unavailable',
    readonly expectedHead: string,
    readonly currentHead: string | null,
    readonly boundary: string,
    message: string,
  ) {
    super(message);
    this.name = 'PullRequestHeadValidationError';
  }
}

export type PullRequestHeadGuard = (boundary: string) => Promise<void>;

/**
 * Prove that a pull request still points at the head this Fleet run reviewed.
 *
 * This intentionally fetches only the live PR JSON, not the diff/files bundle
 * used by {@link fetchPRContext}. It sits on hot publication boundaries, where
 * a cheap authoritative read is preferable to either another expensive
 * context fetch or a stale GitHub mutation.
 */
export async function requireCurrentPullRequestHead(
  owner: string,
  repo: string,
  prNumber: number,
  expectedHead: string,
  token: string,
  boundary: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: ghHeaders(token),
    });
  } catch (err) {
    throw new PullRequestHeadValidationError(
      'unavailable',
      expectedHead,
      null,
      boundary,
      `could not verify pull request head at ${boundary}: ${String(err).slice(0, 240)}`,
    );
  }
  if (!res.ok) {
    throw new PullRequestHeadValidationError(
      'unavailable',
      expectedHead,
      null,
      boundary,
      `could not verify pull request head at ${boundary}: GitHub returned ${res.status}`,
    );
  }
  const live = (await res.json()) as { head?: { sha?: unknown } | null };
  const currentHead = typeof live.head?.sha === 'string' ? live.head.sha : null;
  if (!currentHead) {
    throw new PullRequestHeadValidationError(
      'unavailable',
      expectedHead,
      null,
      boundary,
      `could not verify pull request head at ${boundary}: response omitted head.sha`,
    );
  }
  if (currentHead !== expectedHead) {
    throw new PullRequestHeadValidationError(
      'changed',
      expectedHead,
      currentHead,
      boundary,
      `pull request head changed at ${boundary}: expected ${expectedHead}, current ${currentHead}`,
    );
  }
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
  // The raw diff is the only source the MAP/REDUCE ships inspect. A non-OK
  // response must escape as infrastructure failure, never become an empty
  // diff that a model can incorrectly bless as a complete clean review.
  if (!diffRes.ok) {
    throw new PullRequestDiffFetchError(diffRes.status);
  }
  const livePr = (await prRes.json()) as typeof eventPr;

  // Both bodies are bounded (#7743). They arrive concurrently, so the peak is
  // their sum; an unbounded read of either one can kill the isolate before any
  // catch block exists to report it.
  let files: PRFile[] = [];
  // A failed, malformed, capped, or exactly-full first page cannot prove the
  // whole changed-file set. Carry that uncertainty to the executor instead of
  // silently letting surface gates treat an empty/partial inventory as exact.
  let filesTruncated = !filesRes.ok;
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
        const parsed: unknown = JSON.parse(read.text);
        if (!Array.isArray(parsed)) {
          filesTruncated = true;
        } else {
          files = parsed as PRFile[];
          // This endpoint requests one page only. An exact page could be the
          // complete set or merely the first 100 entries; fail closed to a
          // complete-inventory claim until pagination is implemented.
          filesTruncated = files.length >= PR_FILES_PAGE_SIZE;
        }
      } catch {
        filesTruncated = true;
      }
    }
  }

  const diffRead = await readTextCapped(diffRes, MAX_DIFF_BYTES);
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
    headRepoFullName: livePr.head?.repo?.full_name ?? '',
    baseRepoFullName: livePr.base?.repo?.full_name ?? '',
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
 * Fetch only mutable PR metadata for hot publication boundaries. Changed-file
 * inventory and raw diff are immutable under the exact head/base identities
 * carried here, so rehydrating their multi-megabyte bodies would add OOM risk
 * without strengthening the witness.
 */
export async function fetchPullRequestMetadataWitness(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<PullRequestMetadataWitness> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`fetch pull request metadata failed ${res.status}: ${await res.text()}`);
  }
  const live = (await res.json()) as {
    title?: string | null;
    body?: string | null;
    state?: string | null;
    merged?: boolean;
    head?: { sha?: string; ref?: string; repo?: { full_name?: string } | null } | null;
    base?: { sha?: string; ref?: string; repo?: { full_name?: string } | null } | null;
  };
  return {
    title: live.title ?? '',
    body: live.body ?? '',
    headSha: live.head?.sha ?? '',
    headRef: live.head?.ref ?? '',
    headRepoFullName: live.head?.repo?.full_name ?? '',
    baseSha: live.base?.sha ?? '',
    baseRef: live.base?.ref ?? '',
    baseRepoFullName: live.base?.repo?.full_name ?? '',
    state: live.state ?? '',
    merged: live.merged === true,
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

/**
 * Load one trusted ship contract with absence distinguished from outage.
 *
 * Checkpoint reuse can only trust the exact contract that shaped a prior ship
 * result. A confirmed 404 means the contract is intentionally absent and is a
 * stable binding input; every other response is unavailable infrastructure and
 * must retry rather than silently bind or run as if no contract existed.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param ship Ship whose canonical contract path is requested.
 * @param ref Trusted default-branch ref, never a PR head.
 * @param token GitHub App installation token.
 * @returns Exact contract text, or null only for a confirmed 404.
 */
export async function fetchTrustedShipContract(
  owner: string,
  repo: string,
  ship: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const path = `fleet/ships/${ship}.md`;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetch trusted ship contract ${path} failed ${res.status}`);
  }
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`fetch trusted ship contract ${path} returned an invalid contents payload`);
  }
  const contract = atob(body.content.replace(/\n/g, ''));
  // A successful Contents response still has to contain a usable trusted
  // contract. Treating whitespace as absence would silently weaken the prompt
  // and checkpoint binding even though GitHub confirmed the file exists.
  if (contract.trim().length === 0) {
    throw new Error(`fetch trusted ship contract ${path} returned an empty contract`);
  }
  return contract;
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

/** Checked failure at the required bot-owned ship-comment publication boundary. */
export class ShipCommentPublicationError extends Error {
  readonly retryable = true;

  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ShipCommentPublicationError';
  }
}

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
  githubAppId: string,
  mutationGuard: PullRequestHeadGuard = async () => {},
): Promise<void> {
  if (!body.trim()) return;

  const tag = `<!-- pd-ship:${shipHandle} -->`;
  const commentBody = capBody(
    `**[pd-${shipHandle}]** ${shipRole}\n\n${body}\n\n${tag}`,
    tag,
  );

  // Look for an existing comment with our tag to edit in place (idempotent on
  // retry: the same deliveryId re-running edits, never duplicates).
  const existing = await findExistingComment(
    owner,
    repo,
    prNumber,
    shipHandle,
    token,
    githubAppId,
  );

  if (existing) {
    await mutationGuard(`before patch pd-${shipHandle} comment`);
    let res: Response | null = null;
    try {
      res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing}`,
        {
          method: 'PATCH',
          headers: ghHeaders(token),
          body: JSON.stringify({ body: commentBody }),
        },
      );
    } catch {
      // A disconnected PATCH is ambiguous; exact owned-body readback below is authoritative.
    }
    if (!res?.ok) {
      if (await findExistingComment(
        owner, repo, prNumber, shipHandle, token, githubAppId, commentBody,
      )) return;
      throw new ShipCommentPublicationError(
        `patch pd-${shipHandle} comment failed ${res?.status ?? 'network'}: ${res ? boundedDiagnostic(await res.text()) : 'no response'}`,
        res?.status,
      );
    }
  } else {
    await mutationGuard(`before post pd-${shipHandle} comment`);
    let res: Response | null = null;
    try {
      res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
        {
          method: 'POST',
          headers: ghHeaders(token),
          body: JSON.stringify({ body: commentBody }),
        },
      );
    } catch {
      // A disconnected POST is ambiguous; exact owned-body readback below is authoritative.
    }
    if (!res?.ok) {
      if (await findExistingComment(
        owner, repo, prNumber, shipHandle, token, githubAppId, commentBody,
      )) return;
      throw new ShipCommentPublicationError(
        `post pd-${shipHandle} comment failed ${res?.status ?? 'network'}: ${res ? boundedDiagnostic(await res.text()) : 'no response'}`,
        res?.status,
      );
    }
  }
}

async function findExistingComment(
  owner: string,
  repo: string,
  prNumber: number,
  shipHandle: string,
  token: string,
  githubAppId: string,
  exactBody?: string,
): Promise<number | null> {
  const comments: Array<{
    id: number;
    body: string;
    user?: { type?: string } | null;
    performed_via_github_app?: { id?: number } | null;
  }> = [];
  let nextUrl: string | null =
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  for (let page = 0; nextUrl && page < 10; page++) {
    let res: Response;
    try {
      res = await fetch(nextUrl, { headers: ghHeaders(token) });
    } catch (error) {
      throw new ShipCommentPublicationError(
        `list pd-${shipHandle} comments network failure: ${boundedDiagnostic(String(error))}`,
      );
    }
    if (!res.ok) {
      let diagnostic = '<unreadable response body>';
      try {
        diagnostic = boundedDiagnostic(await res.text());
      } catch {
        // Keep the bounded placeholder.
      }
      throw new ShipCommentPublicationError(
        `list pd-${shipHandle} comments failed ${res.status}: ${diagnostic}`,
        res.status,
      );
    }
    try {
      const pageComments = await res.json() as typeof comments;
      if (!Array.isArray(pageComments)) throw new Error('response is not an array');
      comments.push(...pageComments);
    } catch (error) {
      throw new ShipCommentPublicationError(
        `list pd-${shipHandle} comments returned malformed JSON: ${boundedDiagnostic(String(error))}`,
        res.status,
      );
    }
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
    nextUrl = next?.[1] ?? null;
  }
  if (nextUrl) {
    throw new ShipCommentPublicationError(
      `cannot prove pd-${shipHandle} comment absence: GitHub pagination exceeded 1000 comments`,
    );
  }
  const tag = `<!-- pd-ship:${shipHandle} -->`;
  const expectedAppId = Number(githubAppId);
  if (!Number.isSafeInteger(expectedAppId) || expectedAppId <= 0) {
    throw new ShipCommentPublicationError('cannot prove Fleet comment ownership: invalid GitHub App id');
  }
  const match = comments.find(c =>
    c.body.endsWith(`\n\n${tag}`) &&
    (exactBody === undefined || c.body === exactBody) &&
    c.user?.type === 'Bot' &&
    c.performed_via_github_app?.id === expectedAppId,
  );
  return match?.id ?? null;
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

const FLEET_GENERATION_MARKER_RE =
  /^<!-- pd-fleet:generation=v2;review=(sha256:[a-f0-9]{64});mediator=(sha256:[a-f0-9]{64}|none);run=(run:[A-Za-z0-9._:-]+) -->\n/;

export interface FleetCheckGenerationReceipt {
  reviewInputSha256: string;
  mediatorOrderSha256: string | null;
  creatorRunId: string;
}

async function fleetCheckGenerationHash(
  reviewInputSha256: string,
  mediatorOrderSha256: string | null,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${reviewInputSha256}\u0000${mediatorOrderSha256 ?? 'none'}`),
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Bind a terminal check output to the exact review input that authorized it. */
export function bindFleetReviewInputToCheckSummary(
  summary: string,
  reviewInputSha256: string,
  creatorRunId: string,
  mediatorOrderSha256: string | null,
): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(reviewInputSha256)) {
    throw new Error('invalid Fleet review input digest');
  }
  if (!/^run:[A-Za-z0-9._:-]+$/.test(creatorRunId)) {
    throw new Error('invalid Fleet creator run id');
  }
  if (mediatorOrderSha256 !== null && !/^sha256:[a-f0-9]{64}$/.test(mediatorOrderSha256)) {
    throw new Error('invalid Fleet mediator order digest');
  }
  return `<!-- pd-fleet:generation=v2;review=${reviewInputSha256};mediator=${mediatorOrderSha256 ?? 'none'};run=${creatorRunId} -->\n${summary}`;
}

/** Parse the stable first-line generation receipt from a Fleet check output. */
export function fleetReviewInputFromCheckSummary(summary: string): FleetCheckGenerationReceipt | null {
  const match = FLEET_GENERATION_MARKER_RE.exec(summary);
  return match
    ? {
        reviewInputSha256: match[1],
        mediatorOrderSha256: match[2] === 'none' ? null : match[2],
        creatorRunId: match[3],
      }
    : null;
}

export async function createCheckRun(
  owner: string,
  repo: string,
  name: string,
  headSha: string,
  token: string,
  detailsUrl?: string | null,
  reviewInputSha256?: string,
  creatorRunId?: string,
  mediatorOrderSha256: string | null = null,
): Promise<number> {
  const generationHash = reviewInputSha256
    ? await fleetCheckGenerationHash(reviewInputSha256, mediatorOrderSha256)
    : null;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      name,
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      ...(creatorRunId
        ? {
            external_id: generationHash
              ? `pdfr2:${generationHash}:${creatorRunId}`
              : `pd-fleet-run:v1:${creatorRunId}`,
            ...(reviewInputSha256
              ? { output: {
                  title: 'Port Daddy Fleet',
                  summary: bindFleetReviewInputToCheckSummary(
                    'Fleet review in progress.',
                    reviewInputSha256,
                    creatorRunId,
                    mediatorOrderSha256,
                  ),
                } }
              : {}),
          }
        : {}),
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
    }),
  });
  if (!res.ok) throw new Error(`create Fleet check run failed ${res.status}`);
  const body = (await res.json()) as { id: number };
  if (!body.id) throw new Error('create Fleet check run returned no id');
  return body.id;
}

/** Structured evidence from the required-check completion transport. */
export interface CheckRunCompletionResult {
  ok: boolean;
  diagnostic?: string;
  retryAfterSeconds?: number;
}

/**
 * Queue-visible failure for a required-check completion boundary.
 *
 * Cloudflare can honor the provider's requested delay on redelivery instead
 * of immediately hammering a rate-limited GitHub endpoint.  The diagnostic is
 * already bounded and never includes our request headers or body, so
 * delivery-failure persistence can give the operator a useful remediation
 * trail without recording the GitHub token.
 */
export class CheckRunCompletionError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'CheckRunCompletionError';
  }
}

const CHECK_COMPLETION_MAX_ATTEMPTS = 3;
// Long provider delays belong to the queue, not a sleeping max_concurrency=1
// consumer. Short 1-2s transport retries stay local; rate windows release the
// slot and return with an explicit Cloudflare redelivery delay.
const CHECK_COMPLETION_MAX_LOCAL_DELAY_MS = 5_000;

/**
 * Complete a check run and return the transport evidence needed by the queue.
 *
 * A failed or disconnected PATCH is ambiguous: GitHub may have committed the
 * terminal write before the response was lost.  Read the check back before a
 * second mutation and accept only the exact intended terminal conclusion.
 * Mutative retries follow GitHub's published pacing rules: never closer than
 * one second, honor Retry-After / primary reset, and wait at least one minute
 * for an otherwise-unqualified 403/429.  Delays too large for a bounded local
 * retry are returned to the Cloudflare message retry boundary.
 */
export async function completeCheckRunDetailed(
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  token: string,
  detailsUrl?: string | null,
  title = 'Port Daddy Fleet',
  beforeMutation?: () => Promise<void>,
): Promise<CheckRunCompletionResult> {
  if (!checkRunId) return { ok: false, diagnostic: 'missing check run id' };
  // details_url is (re)stamped on completion too, so a run that REUSED an
  // older check run (idempotent retry path) still links to its own page.
  const body = JSON.stringify({
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    output: { title, summary },
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
  });
  let nextDelayMs = 0;
  let lastDiagnostic = 'completion PATCH did not produce a terminal response';
  for (let attempt = 1; attempt <= CHECK_COMPLETION_MAX_ATTEMPTS; attempt++) {
    if (nextDelayMs > CHECK_COMPLETION_MAX_LOCAL_DELAY_MS) {
      return {
        ok: false,
        diagnostic: lastDiagnostic,
        retryAfterSeconds: Math.min(43_200, Math.ceil(nextDelayMs / 1000)),
      };
    }
    if (nextDelayMs > 0) await sleep(nextDelayMs);
    await beforeMutation?.();
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
        method: 'PATCH',
        headers: ghHeaders(token),
        body,
      });
    } catch (err) {
      lastDiagnostic = `network error: ${boundedDiagnostic(String(err))}`;
      console.error(
        `[fleet-executor] completeCheckRun network error attempt=${attempt}/${CHECK_COMPLETION_MAX_ATTEMPTS} ` +
          `check=${checkRunId}: ${lastDiagnostic}`,
      );
      if (await checkRunReachedConclusion(owner, repo, checkRunId, conclusion, summary, token)) {
        return { ok: true };
      }
      nextDelayMs = 1000 * (2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return { ok: true };
    lastDiagnostic = await checkCompletionDiagnostic(res);
    console.error(
      `[fleet-executor] completeCheckRun PATCH failed attempt=${attempt}/${CHECK_COMPLETION_MAX_ATTEMPTS} ` +
        `check=${checkRunId} ${lastDiagnostic}`,
    );
    if (await checkRunReachedConclusion(owner, repo, checkRunId, conclusion, summary, token)) {
      return { ok: true };
    }
    if (!isRetryableGitHubMutation(res.status)) break;
    nextDelayMs = githubMutationRetryDelayMs(res, attempt);
  }
  console.error(
    `[fleet-executor] completeCheckRun EXHAUSTED retries for check=${checkRunId} owner=${owner} repo=${repo} — ` +
      `${lastDiagnostic}; check remains fail-closed until a future delivery or DLQ completion.`,
  );
  return {
    ok: false,
    diagnostic: lastDiagnostic,
    ...(nextDelayMs > CHECK_COMPLETION_MAX_LOCAL_DELAY_MS
      ? { retryAfterSeconds: Math.min(43_200, Math.ceil(nextDelayMs / 1000)) }
      : {}),
  };
}

/**
 * Compatibility wrapper for callers that need only success/failure.
 *
 * The main queue boundary uses {@link completeCheckRunDetailed} so a provider
 * delay and bounded diagnostic survive into durable delivery evidence.
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
  beforeMutation?: () => Promise<void>,
): Promise<boolean> {
  return (
    await completeCheckRunDetailed(
      owner,
      repo,
      checkRunId,
      conclusion,
      summary,
      token,
      detailsUrl,
      title,
      beforeMutation,
    )
  ).ok;
}

/** Return GitHub-compliant delay for the next mutative request. */
export function githubMutationRetryDelayMs(
  response: Pick<Response, 'status' | 'headers'>,
  attempt: number,
  nowMs = Date.now(),
): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.ceil(seconds * 1000));
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetHeader = response.headers.get('x-ratelimit-reset');
  const reset = Number(resetHeader);
  if (remaining === '0' && resetHeader && Number.isFinite(reset)) {
    return Math.max(1000, Math.ceil(reset * 1000 - nowMs));
  }
  if (response.status === 403 || response.status === 429) {
    return 60_000 * (2 ** Math.max(0, attempt - 1));
  }
  return Math.max(1000, 1000 * (2 ** Math.max(0, attempt - 1)));
}

function isRetryableGitHubMutation(status: number): boolean {
  return status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

async function checkRunReachedConclusion(
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return false;
    const readback = (await res.json()) as {
      status?: string;
      conclusion?: string | null;
      output?: { summary?: string | null } | null;
    };
    return readback.status === 'completed' &&
      readback.conclusion === conclusion &&
      readback.output?.summary === summary;
  } catch {
    return false;
  }
}

async function checkCompletionDiagnostic(res: Response): Promise<string> {
  const requestId = res.headers.get('x-github-request-id');
  const retryAfter = res.headers.get('retry-after');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  let responseBody = '';
  try {
    responseBody = boundedDiagnostic(await res.text());
  } catch {
    responseBody = '<unreadable response body>';
  }
  return [
    `status=${res.status}`,
    requestId ? `request_id=${requestId}` : '',
    retryAfter ? `retry_after=${retryAfter}` : '',
    remaining ? `ratelimit_remaining=${remaining}` : '',
    reset ? `ratelimit_reset=${reset}` : '',
    responseBody ? `body=${responseBody}` : '',
  ].filter(Boolean).join(' ');
}

function boundedDiagnostic(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 512);
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
  githubAppId: string,
  creatorRunId?: string,
): Promise<number | null> {
  const filter = creatorRunId ? 'all' : 'latest';
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100&filter=${filter}&check_name=${encodeURIComponent(name)}&app_id=${encodeURIComponent(githubAppId)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    check_runs?: Array<{
      id: number;
      name: string;
      status?: string;
      conclusion?: string | null;
      external_id?: string | null;
      app?: { id?: number } | null;
    }>;
  };
  const expectedAppId = Number(githubAppId);
  if (!Number.isSafeInteger(expectedAppId) || expectedAppId <= 0) return null;
  const owned = (body.check_runs ?? [])
    .filter(c => c.name === name && c.app?.id === expectedAppId)
    .sort((left, right) => right.id - left.id);
  const match = creatorRunId
    ? owned.find(c =>
        c.external_id === `pd-fleet-run:v1:${creatorRunId}` ||
        c.external_id?.endsWith(`:${creatorRunId}`),
      )
    : owned[0];
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
  githubAppId: string,
  expectedReviewInputSha256: string,
  expectedMediatorOrderSha256: string | null,
): Promise<{
  id: number;
  status: string;
  conclusion: string | null;
  summary: string;
  reviewInputSha256: string | null;
  mediatorOrderSha256: string | null;
  creatorRunId: string | null;
} | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100&app_id=${encodeURIComponent(githubAppId)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    check_runs?: Array<{
      id: number;
      name: string;
      status?: string;
      conclusion?: string | null;
      external_id?: string | null;
      app?: { id?: number } | null;
      output?: { summary?: string | null } | null;
    }>;
  };
  const expectedAppId = Number(githubAppId);
  if (!Number.isSafeInteger(expectedAppId) || expectedAppId <= 0) return null;
  const owned = (body.check_runs ?? [])
    .filter(c => c.name === name && c.app?.id === expectedAppId)
    .sort((left, right) => right.id - left.id);
  const externalReceipt = (check: { external_id?: string | null }): {
    generationHash: string;
    creatorRunId: string;
  } | null => {
    const receipt = /^pdfr2:([a-f0-9]{64}):(run:[A-Za-z0-9._:-]+)$/.exec(
      check.external_id ?? '',
    );
    return receipt
      ? {
          generationHash: receipt[1],
          creatorRunId: receipt[2],
        }
      : null;
  };
  const creatorOnlyReceipt = (check: { external_id?: string | null }): string | null => {
    const receipt = /^pd-fleet-run:v1:(run:[A-Za-z0-9._:-]+)$/.exec(check.external_id ?? '');
    return receipt?.[1] ?? null;
  };
  // Only the newest owned generation can control the required check. Looking
  // past it for an older matching success can strand the newer check pending.
  const match = owned[0];
  if (!match) return null;
  // `summary` comes back on the list endpoint and carries the DLQ handler's
  // dead-letter marker, which is how the caller tells a gate that ships decided
  // apart from one a lost job failed — see dead-letter-marker.ts.
  const summary = match.output?.summary ?? '';
  const external = externalReceipt(match);
  const admissionCreatorRunId = creatorOnlyReceipt(match);
  const terminal = match.status === 'completed' ? fleetReviewInputFromCheckSummary(summary) : null;
  const expectedGenerationHash = await fleetCheckGenerationHash(
    expectedReviewInputSha256,
    expectedMediatorOrderSha256,
  );
  const terminalGenerationHash = terminal
    ? await fleetCheckGenerationHash(terminal.reviewInputSha256, terminal.mediatorOrderSha256)
    : null;
  const receiptMatches = match.status !== 'completed'
    ? external?.generationHash === expectedGenerationHash || admissionCreatorRunId !== null
    : terminal !== null && (
      (external !== null &&
        external.generationHash === terminalGenerationHash &&
        external.creatorRunId === terminal.creatorRunId) ||
      (admissionCreatorRunId !== null && admissionCreatorRunId === terminal.creatorRunId)
    );
  const resolved = match.status === 'completed'
    ? terminal
    : external?.generationHash === expectedGenerationHash
      ? {
          reviewInputSha256: expectedReviewInputSha256,
          mediatorOrderSha256: expectedMediatorOrderSha256,
          creatorRunId: external.creatorRunId,
        }
      : null;
  return {
    id: match.id,
    status: match.status ?? '',
    conclusion: match.conclusion ?? null,
    summary,
    reviewInputSha256: receiptMatches ? resolved?.reviewInputSha256 ?? null : null,
    mediatorOrderSha256: receiptMatches ? resolved?.mediatorOrderSha256 ?? null : null,
    creatorRunId: receiptMatches
      ? resolved?.creatorRunId ?? admissionCreatorRunId
      : null,
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
