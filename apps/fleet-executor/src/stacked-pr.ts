/**
 * Stacked-PR machinery over the GitHub Git Data API — no git binary required,
 * so it runs inside a Cloudflare Worker.
 *
 * Used by the purser ship (src/purser.ts) to publish adversarial test files on
 * a branch cut from a PR's BASE sha, open a test PR for that branch, and then
 * retarget the reviewed PR onto the test branch so the reviewed PR is STACKED
 * on top of the tests and must satisfy them to merge.
 *
 * Every write is IDEMPOTENT by construction:
 *   - {@link createOrUpdateBranch} force-updates the ref when the branch
 *     already exists, so a retried delivery rewrites the same branch instead of
 *     erroring on "reference already exists".
 *   - {@link openStackedPr} looks for an existing open PR for the head branch
 *     FIRST and edits it in place instead of opening a duplicate.
 *
 * PATH SAFETY: the file paths written to the branch come from MODEL OUTPUT
 * (untrusted). {@link validateStackedFiles} rejects traversal (`..`), absolute
 * paths, backslashes, and anything outside a conservative whitelist regex, and
 * caps both file count and per-file size so a runaway model cannot spray a repo
 * with garbage.
 */

/** Hard cap on files per stacked commit. */
export const MAX_STACKED_FILES = 10;
/** Hard cap on a single file's contents, in UTF-8 bytes (48 KB). */
export const MAX_STACKED_FILE_BYTES = 48 * 1024;

/**
 * Conservative path whitelist: relative, slash-separated segments of
 * `[A-Za-z0-9._-]`, each segment starting with an alphanumeric. No leading `/`,
 * no `\`, no spaces, no shell metacharacters — and `..` is impossible because a
 * segment must START with an alphanumeric (checked again explicitly below,
 * belt-and-suspenders).
 */
const SAFE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export interface StackedFile {
  /** Repo-relative path, e.g. `tests/purser/contract.test.ts`. */
  path: string;
  /** Full UTF-8 file contents. */
  contents: string;
}

export type FileValidation = { ok: true } | { ok: false; reason: string };

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Validate a model-authored file set against the path whitelist + size caps.
 * Returns `{ ok: false, reason }` with a human-legible reason (surfaced in the
 * transcript) rather than throwing, so callers can degrade honestly.
 */
export function validateStackedFiles(files: StackedFile[]): FileValidation {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: 'no files' };
  }
  if (files.length > MAX_STACKED_FILES) {
    return { ok: false, reason: `too many files (${files.length} > ${MAX_STACKED_FILES})` };
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.contents !== 'string') {
      return { ok: false, reason: 'file entry missing path or contents' };
    }
    const p = f.path;
    if (p.startsWith('/')) return { ok: false, reason: `absolute path rejected: ${p}` };
    if (p.includes('\\')) return { ok: false, reason: `backslash in path rejected: ${p}` };
    if (p.split('/').some(seg => seg === '..' || seg === '.')) {
      return { ok: false, reason: `path traversal rejected: ${p}` };
    }
    if (!SAFE_PATH_RE.test(p)) {
      return { ok: false, reason: `path outside whitelist rejected: ${p}` };
    }
    if (seen.has(p)) return { ok: false, reason: `duplicate path: ${p}` };
    seen.add(p);
    const bytes = utf8Bytes(f.contents);
    if (bytes > MAX_STACKED_FILE_BYTES) {
      return {
        ok: false,
        reason: `file too large: ${p} (${bytes} > ${MAX_STACKED_FILE_BYTES} bytes)`,
      };
    }
  }
  return { ok: true };
}

/**
 * Error carrying the HTTP status of a failed GitHub call, so callers can key on
 * e.g. 403 (App lacks `contents: write`) and degrade honestly instead of
 * guessing from a message string.
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'port-daddy-fleet/1.0',
  };
}

async function ghJson<T>(
  url: string,
  init: RequestInit,
  token: string,
  what: string,
): Promise<T> {
  const res = await fetch(url, { ...init, headers: ghHeaders(token) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GitHubApiError(`${what} failed ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as T;
}

export interface BranchCommitResult {
  /** SHA of the commit now at the branch tip. */
  commitSha: string;
  /** True when the ref was newly created; false when force-updated (retry). */
  created: boolean;
}

/**
 * Create (or force-update) `branchName` to a single commit on top of `fromSha`
 * containing exactly `files`, via blobs → tree → commit → ref. If the ref
 * already exists the update is FORCED, so a retried delivery converges on the
 * same state instead of failing — the branch is executor-owned, never a human's.
 *
 * Throws {@link GitHubApiError} on any GitHub failure (403 ⇒ the App lacks
 * `contents: write`; callers degrade honestly).
 */
export async function createOrUpdateBranch(
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string,
  files: StackedFile[],
  message: string,
  token: string,
): Promise<BranchCommitResult> {
  const v = validateStackedFiles(files);
  if (!v.ok) throw new Error(`createOrUpdateBranch refused: ${v.reason}`);

  const base = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Resolve the base commit's tree.
  const baseCommit = await ghJson<{ tree: { sha: string } }>(
    `${base}/git/commits/${fromSha}`,
    { method: 'GET' },
    token,
    'get base commit',
  );

  // 2. One blob per file.
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const f of files) {
    const blob = await ghJson<{ sha: string }>(
      `${base}/git/blobs`,
      { method: 'POST', body: JSON.stringify({ content: f.contents, encoding: 'utf-8' }) },
      token,
      `create blob ${f.path}`,
    );
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3. Tree on top of the base tree.
  const tree = await ghJson<{ sha: string }>(
    `${base}/git/trees`,
    { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }) },
    token,
    'create tree',
  );

  // 4. Commit with the base as sole parent.
  const commit = await ghJson<{ sha: string }>(
    `${base}/git/commits`,
    { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [fromSha] }) },
    token,
    'create commit',
  );

  // 5. Ref: create, or force-update when it already exists (idempotent retry).
  const createRes = await fetch(`${base}/git/refs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
  });
  if (createRes.ok) return { commitSha: commit.sha, created: true };

  if (createRes.status === 422) {
    // "Reference already exists" — force-move it to the fresh commit.
    await ghJson(
      `${base}/git/refs/heads/${branchName}`,
      { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: true }) },
      token,
      `force-update ref ${branchName}`,
    );
    return { commitSha: commit.sha, created: false };
  }

  const text = await createRes.text().catch(() => '');
  throw new GitHubApiError(
    `create ref ${branchName} failed ${createRes.status}: ${text.slice(0, 300)}`,
    createRes.status,
  );
}

export interface StackedPrResult {
  number: number;
  url: string;
  /** True when an existing open PR for the head branch was reused. */
  existed: boolean;
}

/**
 * Open a PR `head` → `base` — but FIRST look for an existing open PR with that
 * head and reuse it (editing title/body in place), so a retried delivery never
 * opens a duplicate. Labels are applied best-effort (a labels failure never
 * fails the PR).
 */
export async function openStackedPr(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  labels: string[],
  token: string,
): Promise<StackedPrResult> {
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // Idempotency: find an existing open PR for this head branch.
  const existing = await ghJson<Array<{ number: number; html_url: string; head?: { ref?: string } }>>(
    `${apiBase}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=50`,
    { method: 'GET' },
    token,
    'list open PRs',
  ).catch(() => [] as Array<{ number: number; html_url: string; head?: { ref?: string } }>);

  // Defensive client-side filter: never trust the server applied the head filter.
  const match = existing.find(p => p.head?.ref === head);
  if (match) {
    // Refresh title/body in place; best-effort (staleness is not worth a throw).
    await fetch(`${apiBase}/pulls/${match.number}`, {
      method: 'PATCH',
      headers: ghHeaders(token),
      body: JSON.stringify({ title, body }),
    }).catch(() => undefined);
    return { number: match.number, url: match.html_url, existed: true };
  }

  const created = await ghJson<{ number: number; html_url: string }>(
    `${apiBase}/pulls`,
    { method: 'POST', body: JSON.stringify({ title, head, base, body }) },
    token,
    'create stacked PR',
  );

  if (labels.length > 0) {
    await fetch(`${apiBase}/issues/${created.number}/labels`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ labels }),
    }).catch(() => undefined);
  }

  return { number: created.number, url: created.html_url, existed: false };
}

/**
 * Retarget an existing PR's base branch (the STACK move: pointing the reviewed
 * PR at the purser's test branch so it must merge through the tests). Throws
 * {@link GitHubApiError} on failure — callers decide whether that degrades the
 * run or is merely reported.
 */
export async function retargetPrBase(
  owner: string,
  repo: string,
  prNumber: number,
  newBase: string,
  token: string,
): Promise<void> {
  await ghJson(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    { method: 'PATCH', body: JSON.stringify({ base: newBase }) },
    token,
    `retarget PR #${prNumber} base`,
  );
}

// ---------------------------------------------------------------------------
// Re-run support: read back a branch the purser wrote earlier.

/**
 * Read the purser's previously-authored test files back off its own branch.
 *
 * WHY: without this the purser has no memory. Every `synchronize` re-ran the
 * steel-man AND the test-author call, burning two model calls and rewriting
 * test files that were already correct — churn the PR author then has to
 * re-read. To re-run existing tests instead of re-authoring them, the contents
 * have to come from somewhere, and the branch is the only durable copy.
 *
 * Uses the git *tree* API rather than one contents call per path, so the cost
 * is two requests regardless of file count, and returns `null` (never throws
 * for absence) when the ref does not exist — a first run is the normal case,
 * not an error.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param branchName The executor-owned branch, e.g. `purser/pr-42-tests`.
 * @param token Installation token.
 * @returns The files at the branch tip, or null when the branch does not exist.
 */
export async function readBranchFiles(
  owner: string,
  repo: string,
  branchName: string,
  token: string,
): Promise<StackedFile[] | null> {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  let tree: { tree?: Array<{ path?: string; type?: string; sha?: string }> };
  try {
    tree = await ghJson(
      `${base}/git/trees/${encodeURIComponent(branchName)}?recursive=1`,
      { method: 'GET' },
      token,
      `read tree ${branchName}`,
    );
  } catch (err) {
    // 404 ⇒ no previous run for this PR. Anything else is a real failure, but
    // the caller's contract is "fall back to authoring", so absence and
    // unreachability converge on the same safe behaviour.
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }

  const blobs = (tree.tree ?? []).filter(
    (e): e is { path: string; type: string; sha: string } =>
      e.type === 'blob' && typeof e.path === 'string' && typeof e.sha === 'string',
  );
  if (blobs.length === 0) return null;

  const files: StackedFile[] = [];
  for (const b of blobs) {
    const blob = await ghJson<{ content?: string; encoding?: string }>(
      `${base}/git/blobs/${b.sha}`,
      { method: 'GET' },
      token,
      `read blob ${b.path}`,
    );
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') continue;
    // atob yields latin-1 code units; re-decode as UTF-8 so non-ASCII test
    // content survives the round trip.
    const bin = atob(blob.content.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    files.push({ path: b.path, contents: new TextDecoder().decode(bytes) });
  }
  return files.length > 0 ? files : null;
}

/**
 * Find the purser's existing OPEN test PR for a branch, if any.
 *
 * Returned alongside its body so the caller can recover the embedded contract
 * fingerprint without a second round trip. Null when no open PR heads that
 * branch — which is both the first-run case and the case where a human closed
 * the test PR deliberately, and in the latter the purser SHOULD author afresh
 * rather than resurrect a rejected suite.
 *
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param branchName The executor-owned test branch.
 * @param token Installation token.
 * @returns `{ number, url, body }` for the open PR, or null.
 */
export async function findOpenPrForBranch(
  owner: string,
  repo: string,
  branchName: string,
  token: string,
): Promise<{ number: number; url: string; body: string } | null> {
  const list = await ghJson<Array<{ number?: number; html_url?: string; body?: string | null }>>(
    `https://api.github.com/repos/${owner}/${repo}/pulls` +
      `?state=open&head=${encodeURIComponent(`${owner}:${branchName}`)}&per_page=1`,
    { method: 'GET' },
    token,
    `find open PR for ${branchName}`,
  );
  const pr = Array.isArray(list) ? list[0] : undefined;
  if (!pr || typeof pr.number !== 'number') return null;
  return { number: pr.number, url: pr.html_url ?? '', body: pr.body ?? '' };
}
