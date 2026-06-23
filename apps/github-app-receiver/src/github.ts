/**
 * GitHub API helpers for the cloud fleet executor.
 *
 * Uses the GitHub App installation token (minted from the App private key JWT)
 * to fetch PR diffs, repo files, and post review comments.
 *
 * No Node.js dependencies — all crypto via Web Crypto API so this runs in
 * Cloudflare Workers.
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

export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<string> {
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
  const body = (await res.json()) as { token: string };
  return body.token;
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
  baseSha: string;
  installationId: number;
  files: PRFile[];
  diff: string;
}

export async function fetchPRContext(
  owner: string,
  repo: string,
  prNumber: number,
  prPayload: Record<string, unknown>,
  token: string,
): Promise<PRContext> {
  const pr = prPayload as {
    number: number;
    title: string;
    body: string;
    head: { sha: string };
    base: { sha: string };
  };

  const [filesRes, diffRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, {
      headers: ghHeaders(token),
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: { ...ghHeaders(token), Accept: 'application/vnd.github.v3.diff' },
    }),
  ]);

  const files: PRFile[] = filesRes.ok ? ((await filesRes.json()) as PRFile[]) : [];
  const diff = diffRes.ok ? await diffRes.text() : '';

  return {
    owner,
    repo,
    prNumber,
    title: pr.title ?? '',
    body: pr.body ?? '',
    headSha: pr.head?.sha ?? '',
    baseSha: pr.base?.sha ?? '',
    installationId: 0,
    files,
    diff,
  };
}

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
// Commenting

const SHIP_TAG_RE = /<!-- pd-ship:([\w-]+) -->/;

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
  const commentBody = `**[pd-${shipHandle}]** ${shipRole}\n\n${body}\n\n${tag}`;

  // Look for an existing comment with our tag to edit in place
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
// Check runs

export async function createCheckRun(
  owner: string,
  repo: string,
  name: string,
  headSha: string,
  token: string,
): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      name,
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
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
): Promise<void> {
  if (!checkRunId) return;
  await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output: { title: 'Port Daddy Fleet', summary },
    }),
  });
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
