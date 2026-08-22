/**
 * GitHub App helpers for the relay fleet control-plane.
 *
 * DUPLICATED (Workers-native, Web Crypto only) from
 * apps/fleet-executor/src/github.ts:19-258 — JWT minting, KV-backed
 * installation-token caching, and zero-trust `fetchRepoFile`. Plus the
 * Contents/Git/Pulls API helpers the save endpoint needs to commit to a NEW
 * branch and open a PR. No @octokit, no Node deps.
 *
 * ZERO-TRUST: the control-plane reads config from the TRUSTED ref only and
 * writes ONLY to a fresh branch + PR. It never mutates the runtime fleet state
 * (no D1, no hot-reload) — the executor reads from `main`, and PR review/merge
 * is the gate.
 */

const GH_API = 'https://api.github.com';

function appHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'port-daddy-relay/1.0',
  };
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'port-daddy-relay/1.0',
  };
}

// ---------------------------------------------------------------------------
// GitHub App JWT (Workers-native Web Crypto, no @octokit/auth-app)

async function signJwt(payload: Record<string, unknown>, pemKey: string): Promise<string> {
  const pem = pemKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

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
  expires_at?: string;
}

async function mintInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<{ token: string; expiresAt: number }> {
  const jwt = await mintAppJwt(appId, privateKeyPem);
  const res = await fetch(
    `${GH_API}/app/installations/${installationId}/access_tokens`,
    { method: 'POST', headers: appHeaders(jwt) },
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
 * KV-backed installation-token cache (key `github_inst_<installationId>`),
 * honored only while >60s of life remains. Mirrors
 * fleet-executor/src/github.ts:126-157.
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
  if (ttlSeconds >= 60) {
    await kv.put(key, JSON.stringify({ token, expiresAt }), { expirationTtl: ttlSeconds });
  }
  return token;
}

/**
 * Resolve the installation id for a repo via the App JWT (cached in KV keyed by
 * `github_repo_inst_<owner>_<repo>`). Avoids requiring an explicit
 * GITHUB_APP_INSTALLATION_ID env var — the App already knows where it is
 * installed. Exported for the Shipwright PR route, which uses this as the
 * authoritative repo→installation binding check (GitHub's own answer, never the
 * caller's claim): a PR can only be opened in a repo whose installation the
 * signed-in user provably owns.
 */
export async function getRepoInstallationId(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
  kv: KVNamespace,
): Promise<number> {
  const key = `github_repo_inst_${owner}_${repo}`;
  const cached = await kv.get(key);
  if (cached) {
    const id = Number(cached);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const jwt = await mintAppJwt(appId, privateKeyPem);
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/installation`, {
    headers: appHeaders(jwt),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub App installation lookup failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { id?: number };
  if (!body.id) throw new Error('GitHub App installation lookup returned no id');
  await kv.put(key, String(body.id), { expirationTtl: 24 * 60 * 60 });
  return body.id;
}

/**
 * Convenience: resolve a repo-scoped installation token (id lookup + token
 * mint, both KV-cached).
 */
export async function getRepoToken(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
  kv: KVNamespace,
): Promise<string> {
  const installationId = await getRepoInstallationId(appId, privateKeyPem, owner, repo, kv);
  return getInstallationTokenCached(appId, privateKeyPem, installationId, kv);
}

/**
 * The repo's default branch (`main`, `master`, …) per GitHub. The Shipwright
 * PR route targets THIS — the operator's own trusted ref — so the zero-trust
 * shape (PR into the branch the fleet-executor reads from) holds for tenant
 * repos exactly as it does for the operator repo's DEFAULT_BRANCH env.
 */
export async function getRepoDefaultBranch(
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`repo lookup failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { default_branch?: string };
  if (!body.default_branch) throw new Error('repo lookup response missing default_branch');
  return body.default_branch;
}

// ---------------------------------------------------------------------------
// Read helpers

/**
 * Fetch a file's contents at a given ref. ZERO-TRUST: callers MUST pass a
 * trusted ref (the default branch), never `pull_request.head.sha`.
 * Returns the decoded text or null if the file does not exist.
 */
export async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (body.encoding !== 'base64' || !body.content) return null;
  return atob(body.content.replace(/\n/g, ''));
}

export interface ShipFileRef {
  path: string;
  name: string;
}

/**
 * List the ship contract files under fleet/ships at a trusted ref. Maps each
 * `*.md` file to `{ path, name }` (name = basename without extension).
 */
export async function listShipFiles(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<ShipFileRef[]> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/fleet/ships?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as Array<{ name: string; path: string; type: string }>;
  if (!Array.isArray(body)) return [];
  return body
    .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    .map((e) => ({ path: e.path, name: e.name.replace(/\.md$/, '') }));
}

// ---------------------------------------------------------------------------
// Write helpers (save endpoint) — branch + commit + PR

/** UTF-8 safe base64 encode for file contents. */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Get the SHA at the tip of a branch (`refs/heads/<branch>`). */
export async function getBranchSha(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`get branch ref failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { object?: { sha?: string } };
  const sha = body.object?.sha;
  if (!sha) throw new Error('branch ref response missing object.sha');
  return sha;
}

/** Create a new branch ref pointing at `sha`. */
export async function createBranch(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create branch failed ${res.status}: ${text}`);
  }
}

/** The current blob SHA for a file on a ref, or null if it does not exist. */
async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { sha?: string };
  return body.sha ?? null;
}

/**
 * Create or update a file on `branch`. The base `sha` (if the file already
 * exists on the trusted ref) is required by the Contents API for an update.
 */
export async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  baseRef: string,
  token: string,
): Promise<void> {
  const sha = await getFileSha(owner, repo, path, baseRef, token);
  const payload: Record<string, unknown> = {
    message,
    content: utf8ToBase64(content),
    branch,
  };
  if (sha) payload.sha = sha;

  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed ${res.status}: ${text}`);
  }
}

/** Open a PR from `head` into `base`. Returns the PR html_url. */
export async function createPr(
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string,
  token: string,
): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create PR failed ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { html_url?: string };
  if (!json.html_url) throw new Error('create PR response missing html_url');
  return json.html_url;
}
