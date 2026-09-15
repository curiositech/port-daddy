/**
 * Browser-only operator surface for standing GitHub publisher grants.
 *
 * A grant is never agent-writable and its id is not a bearer. Every page load
 * and mutation obtains fresh GitHub evidence that the signed-in user is a repo
 * admin and owns the App installation that currently reaches that exact repo.
 */
import type { Env } from './types.js';
import { isSameOrigin, resolveSession, type ResolvedSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';
import { normalizeRepoFullName } from './repo-settings-page.js';
import { randomHex } from './crypto.js';

const OPERATIONS = [
  'pull-request.publish', 'pull-request.update', 'pull-request.ready',
  'pull-request.request-reviewers', 'pull-request.comment',
  'pull-request.review-reply', 'pull-request.enqueue', 'pull-request.inspect',
] as const;
const EXPIRY_DAYS = new Set([1, 7, 30, 90]);
const MAX_FORM_BYTES = 16_384;
const MAX_INSTALLATIONS = 20;
const MAX_REPOSITORIES_PER_INSTALLATION = 500;

interface GithubAuthority { installationId: number; }
interface IdentityView { fingerprint: string; createdAt: number; expiresAt: number | null; }
interface GrantView {
  grantId: string; subjectFingerprint: string; installationId: number;
  repositories: string[]; operations: string[]; branchAllow: string[];
  baseAllow: string[]; mutationsPerDay: number; expiresAt: number;
  createdAt: number; revokedAt: number | null; revokedReason: string | null;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

async function boundedForm(request: Request): Promise<URLSearchParams | null> {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(request.headers.get('Content-Length')) > MAX_FORM_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) return null;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  try { return new URLSearchParams(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(joined)); }
  catch { return null; }
}

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'port-daddy-relay' };
}

/** Establish both halves of authority from GitHub now, never from saved D1. */
async function freshGithubAuthority(session: ResolvedSession, repo: string): Promise<GithubAuthority | null> {
  if (!session.ghToken) return null;
  const headers = githubHeaders(session.ghToken);
  const metadata = await fetch(`https://api.github.com/repos/${repo}`, { headers, redirect: 'manual' });
  if (!metadata.ok) return null;
  let repoBody: { full_name?: unknown; permissions?: { admin?: unknown } };
  try { repoBody = await metadata.json() as typeof repoBody; } catch { return null; }
  if (typeof repoBody.full_name !== 'string' || repoBody.full_name.toLowerCase() !== repo
      || repoBody.permissions?.admin !== true) return null;

  // Ask for one full GitHub page and refuse an account larger than this
  // surface's reviewable bound rather than silently omitting installations.
  const installationsResponse = await fetch('https://api.github.com/user/installations?per_page=100', { headers, redirect: 'manual' });
  if (!installationsResponse.ok) return null;
  let installationBody: { installations?: unknown };
  try { installationBody = await installationsResponse.json() as typeof installationBody; } catch { return null; }
  if (!Array.isArray(installationBody.installations) || installationBody.installations.length > MAX_INSTALLATIONS) return null;
  const installationIds = installationBody.installations.flatMap((value) => {
    const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : null;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? [id] : [];
  });
  for (const installationId of installationIds) {
    for (let page = 1; page <= 5; page += 1) {
      const response = await fetch(`https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`, { headers, redirect: 'manual' });
      if (!response.ok) return null;
      let body: { repositories?: unknown };
      try { body = await response.json() as typeof body; } catch { return null; }
      if (!Array.isArray(body.repositories)) return null;
      if (body.repositories.some((value) => typeof value === 'object' && value !== null
          && typeof (value as { full_name?: unknown }).full_name === 'string'
          && ((value as { full_name: string }).full_name).toLowerCase() === repo)) return { installationId };
      if (body.repositories.length < 100) break;
      if (page * 100 >= MAX_REPOSITORIES_PER_INSTALLATION) return null;
    }
  }
  return null;
}

function validFingerprint(value: string | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function metadataRepo(metadata: string): string | null {
  try {
    const parsed = JSON.parse(metadata) as { repository?: unknown };
    return typeof parsed.repository === 'string' ? parsed.repository.toLowerCase() : null;
  } catch { return null; }
}

async function liveIdentities(env: Env, repo: string, now: number): Promise<IdentityView[] | null> {
  try {
    const result = await env.DB.prepare(
      `SELECT daemon_fingerprint, proof_metadata, expires_at, created_at
         FROM identities
        WHERE proof_method = 'oidc' AND revoked = 0
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC LIMIT 101`,
    ).bind(now).all<{ daemon_fingerprint: string; proof_metadata: string; expires_at: number | null; created_at: number }>();
    if (!result.success || result.results.length > 100) return null;
    return result.results.flatMap((row) => validFingerprint(row.daemon_fingerprint) && metadataRepo(row.proof_metadata) === repo
      ? [{ fingerprint: row.daemon_fingerprint, createdAt: row.created_at, expiresAt: row.expires_at }] : []);
  } catch { return null; }
}

function stringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null;
  } catch { return null; }
}

function storedBranchList(values: string[], kind: 'prefix' | 'base'): boolean {
  return values.length > 0 && values.length <= 16 && new Set(values).size === values.length
    && values.every((value) => splitList(value, kind)?.length === 1);
}

async function grantsForAccount(env: Env, userId: string, repo: string): Promise<GrantView[] | null> {
  try {
    const result = await env.DB.prepare(
      `SELECT grant_id, subject_fingerprint, installation_id, repositories_json,
              operations_json, branch_allow_json, base_allow_json,
              mutations_per_day, expires_at, created_at, revoked_at, revoked_reason
         FROM publisher_grants WHERE account_user_id = ? AND surface = 'publisher'
        ORDER BY created_at DESC LIMIT 101`,
    ).bind(userId).all<Record<string, unknown>>();
    if (!result.success || result.results.length > 100) return null;
    const out: GrantView[] = [];
    for (const row of result.results) {
      const repositories = stringArray(String(row.repositories_json));
      const operations = stringArray(String(row.operations_json));
      const branchAllow = stringArray(String(row.branch_allow_json));
      const baseAllow = stringArray(String(row.base_allow_json));
      // A malformed grant is authority-corrupting state, not an empty state.
      // Fail the whole read so the operator cannot mistake a hidden row for an
      // absent permission.
      if (!repositories) return null;
      if (!repositories.includes(repo)) continue;
      if (!operations || !branchAllow || !baseAllow
          || !/^pdg_[0-9a-f]{32}$/.test(String(row.grant_id))
          || !validFingerprint(String(row.subject_fingerprint))
          || operations.length === 0 || operations.length > OPERATIONS.length
          || new Set(operations).size !== operations.length
          || operations.some((operation) => !(OPERATIONS as readonly string[]).includes(operation))
          || !storedBranchList(branchAllow, 'prefix') || !storedBranchList(baseAllow, 'base')
          || !Number.isSafeInteger(Number(row.installation_id)) || Number(row.installation_id) <= 0
          || !Number.isSafeInteger(Number(row.mutations_per_day)) || Number(row.mutations_per_day) <= 0
          || !Number.isSafeInteger(Number(row.expires_at)) || !Number.isSafeInteger(Number(row.created_at))) return null;
      out.push({ grantId: String(row.grant_id), subjectFingerprint: String(row.subject_fingerprint),
        installationId: Number(row.installation_id), repositories, operations, branchAllow, baseAllow,
        mutationsPerDay: Number(row.mutations_per_day), expiresAt: Number(row.expires_at),
        createdAt: Number(row.created_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
        revokedReason: row.revoked_reason === null ? null : String(row.revoked_reason) });
    }
    return out;
  } catch { return null; }
}

function splitList(value: string | null, kind: 'prefix' | 'base'): string[] | null {
  if (typeof value !== 'string') return null;
  const values = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (values.length === 0 || values.length > 16) return null;
  const safe = (item: string) => item.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(item)
    && !item.includes('..') && !item.includes('//') && !item.includes('@{') && !item.includes('*')
    && !item.endsWith('.') && !item.endsWith('.lock') && (kind === 'prefix' || !item.endsWith('/'));
  return values.every(safe) ? values : null;
}

function page(repo: string, authority: GithubAuthority | null, identities: IdentityView[] | null,
  grants: GrantView[] | null, notice = ''): string {
  const operationChecks = OPERATIONS.map((operation) => `<label><input type="checkbox" name="operation" value="${operation}">${operation}</label>`).join('');
  const identityOptions = (identities ?? []).map((identity) => `<option value="${identity.fingerprint}">${identity.fingerprint.slice(0, 16)}… · ${identity.expiresAt ? `expires ${new Date(identity.expiresAt * 1000).toISOString()}` : 'no identity expiry'}</option>`).join('');
  const rows = (grants ?? []).map((grant) => `<article class="grant"><h2>${esc(grant.grantId)}</h2>
    <p class="mono">Identity ${esc(grant.subjectFingerprint.slice(0, 16))}… · installation ${grant.installationId}</p>
    <p>${esc(grant.operations.join(', '))}</p><p class="muted">Heads: ${esc(grant.branchAllow.join(', '))} · bases: ${esc(grant.baseAllow.join(', '))} · ${grant.mutationsPerDay}/day · expires ${esc(new Date(grant.expiresAt * 1000).toISOString())}</p>
    ${grant.revokedAt ? `<strong class="revoked">Revoked ${esc(new Date(grant.revokedAt * 1000).toISOString())}</strong>` : `<form method="post" action="/account/publisher-grants/revoke"><input type="hidden" name="repo" value="${esc(repo)}"><input type="hidden" name="grant_id" value="${esc(grant.grantId)}"><button class="danger">Revoke now</button></form>`}</article>`).join('');
  return `<!doctype html><html lang="en"><head><title>Publisher grants · Port Daddy</title>${HEAD}<style>${TOKENS}
  body{background:var(--surface-base)}.shell{max-width:1080px;margin:auto;padding:28px}.crumbs{display:flex;gap:18px;border-bottom:2px solid var(--border-strong);padding-bottom:16px}h1{font-size:clamp(34px,6vw,58px);margin:38px 0 8px}.lede,.muted{color:var(--text-muted)}.notice{border-left:5px solid var(--amber);padding:12px;margin:20px 0;background:var(--surface-raised)}form.panel,.grant{border:2px solid var(--border-strong);padding:20px;margin:22px 0;background:var(--surface-raised)}label{display:block;margin:10px 0}input,select{background:var(--surface-base);border:1px solid var(--hair-strong);padding:9px;max-width:100%}input[type=text],select{width:100%}.ops{columns:2}.ops label{break-inside:avoid}.button,button{display:inline-block;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);font-weight:700;padding:10px 14px;text-decoration:none;cursor:pointer}.danger{background:var(--error)}.revoked{color:var(--error)}@media(max-width:650px){.ops{columns:1}.shell{padding:18px}}
  </style></head><body><main class="shell"><nav class="crumbs"><a href="/account">Account</a><a href="/account/ships?repo=${encodeURIComponent(repo)}">Ship controls</a></nav>
  <h1>Publisher grants</h1><p class="lede">Permit one live workload identity to publish through the GitHub App. The selected repository, operations and branches are ceilings—not suggestions.</p>
  <form class="panel" method="get" action="/account/publisher-grants"><label>Exact repository <input required name="repo" value="${esc(repo)}" placeholder="owner/repository"></label><button>Verify repository</button></form>
  ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
  ${authority && identities && grants ? `<p class="mono">Fresh GitHub witness · App installation ${authority.installationId}</p>
    ${identityOptions ? `<form class="panel" method="post" action="/account/publisher-grants/create"><h2>Create a bounded grant</h2>
      <input type="hidden" name="repo" value="${esc(repo)}"><label>Live OIDC identity<select name="subject_fingerprint" required>${identityOptions}</select></label>
      <fieldset class="ops"><legend>Allowed operations</legend>${operationChecks}</fieldset>
      <label>Head branch prefixes, comma separated<input name="branch_allow" required value="codex/"></label>
      <label>Exact base branches, comma separated<input name="base_allow" required value="main"></label>
      <label>Mutations per UTC day<input name="mutations_per_day" type="number" min="1" max="100" value="20" required></label>
      <label>Expires after<select name="expires_days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
      <button>Create grant</button></form>` : '<p class="notice">No live OIDC identity has an exact proof for this repository. Exchange a newly issued trusted workflow identity first.</p>'}
    <section aria-labelledby="existing"><h2 id="existing">Existing grants</h2>${rows || '<p>No grants for this exact repository.</p>'}</section>` : ''}
  </main></body></html>`;
}

/** GET/create/revoke account routes. No bearer-token path reaches this handler. */
export async function handlePublisherGrantsPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
  const writing = request.method === 'POST';
  if (writing && (!request.headers.has('Origin') && !request.headers.has('Referer'))) return html('Browser origin evidence is required.', 403);
  if (writing && !isSameOrigin(request, env)) return html('Cross-origin change refused.', 403);
  const form = writing ? await boundedForm(request) : null;
  if (writing && !form) return html('Expected a bounded encoded form.', 415);
  const url = new URL(request.url);
  const normalized = normalizeRepoFullName(writing ? form?.get('repo') : url.searchParams.get('repo'));
  const repo = normalized?.toLowerCase() ?? '';
  if (!repo) return html(page('', null, null, null, writing ? 'Enter an exact owner/repository.' : ''), writing ? 400 : 200);

  let authority: GithubAuthority | null;
  try { authority = await freshGithubAuthority(session, repo); } catch { authority = null; }
  if (!authority) return html(page(repo, null, null, null, 'Fresh repository-admin and GitHub App installation checks failed. No grant changed.'), 403);
  const now = Math.floor(Date.now() / 1000);
  const identities = await liveIdentities(env, repo, now);
  const grants = await grantsForAccount(env, session.user.id, repo);
  if (!identities || !grants) return html(page(repo, authority, null, null, 'Publisher grant storage is unavailable. No grant changed.'), 503);
  if (!writing) return html(page(repo, authority, identities, grants,
    url.searchParams.get('saved') === '1' ? 'Created and read back from storage.' : url.searchParams.get('revoked') === '1' ? 'Revoked and read back from storage.' : ''));

  if (url.pathname.endsWith('/create')) {
    const fingerprint = form!.get('subject_fingerprint');
    const operations = form!.getAll('operation');
    const branchAllow = splitList(form!.get('branch_allow'), 'prefix');
    const baseAllow = splitList(form!.get('base_allow'), 'base');
    const mutations = Number(form!.get('mutations_per_day'));
    const expiryDays = Number(form!.get('expires_days'));
    if (!validFingerprint(fingerprint) || !identities.some((item) => item.fingerprint === fingerprint)
        || operations.length === 0 || operations.length > OPERATIONS.length
        || new Set(operations).size !== operations.length || operations.some((operation) => !(OPERATIONS as readonly string[]).includes(operation))
        || !branchAllow || !baseAllow || !Number.isInteger(mutations) || mutations < 1 || mutations > 100
        || !EXPIRY_DAYS.has(expiryDays)) return html('Invalid publisher grant scope.', 400);
    const grantId = `pdg_${randomHex(16)}`;
    const expiresAt = now + expiryDays * 86_400;
    const createdIp = request.headers.get('CF-Connecting-IP');
    try {
      await env.DB.prepare(`INSERT INTO publisher_grants
        (grant_id, epoch, surface, account_user_id, subject_fingerprint, subject_class,
         installation_id, repositories_json, operations_json, branch_allow_json,
         base_allow_json, mutations_per_day, expires_at, created_at, created_via, created_ip)
        VALUES (?, 1, 'publisher', ?, ?, 'ci', ?, ?, ?, ?, ?, ?, ?, ?, 'account-ui', ?)`)
        .bind(grantId, session.user.id, fingerprint, authority.installationId, JSON.stringify([repo]),
          JSON.stringify(operations), JSON.stringify(branchAllow), JSON.stringify(baseAllow), mutations,
          expiresAt, now, createdIp && createdIp.length <= 64 ? createdIp : null).run();
      const readback = await env.DB.prepare(`SELECT grant_id, epoch, surface, account_user_id,
          subject_fingerprint, subject_class, installation_id, repositories_json,
          operations_json, branch_allow_json, base_allow_json, mutations_per_day,
          expires_at, created_at, created_via, revoked_at
        FROM publisher_grants WHERE grant_id = ? AND account_user_id = ?`)
        .bind(grantId, session.user.id).first<Record<string, unknown>>();
      if (!readback || readback.grant_id !== grantId || readback.epoch !== 1
          || readback.surface !== 'publisher' || readback.account_user_id !== session.user.id
          || readback.subject_fingerprint !== fingerprint || readback.subject_class !== 'ci'
          || readback.installation_id !== authority.installationId
          || readback.repositories_json !== JSON.stringify([repo])
          || readback.operations_json !== JSON.stringify(operations)
          || readback.branch_allow_json !== JSON.stringify(branchAllow)
          || readback.base_allow_json !== JSON.stringify(baseAllow)
          || readback.mutations_per_day !== mutations || readback.expires_at !== expiresAt
          || readback.created_at !== now || readback.created_via !== 'account-ui'
          || readback.revoked_at !== null) return html('Grant write was not confirmed by exact readback.', 503);
    } catch { return html('Publisher grant storage refused the change.', 503); }
    return redirect(`/account/publisher-grants?repo=${encodeURIComponent(repo)}&saved=1`);
  }

  if (url.pathname.endsWith('/revoke')) {
    const grantId = form!.get('grant_id');
    if (typeof grantId !== 'string' || !/^pdg_[0-9a-f]{32}$/.test(grantId)) return html('Invalid publisher grant.', 400);
    const selected = grants.find((grant) => grant.grantId === grantId && grant.installationId === authority.installationId && !grant.revokedAt);
    if (!selected) return html('That live grant does not belong to this account and exact repository.', 403);
    try {
      const changed = await env.DB.prepare(`UPDATE publisher_grants SET revoked_at = ?, revoked_reason = 'operator-ui'
        WHERE grant_id = ? AND account_user_id = ? AND revoked_at IS NULL`).bind(now, grantId, session.user.id).run();
      if (changed.meta?.changes !== 1) return html('Grant was not revoked; reload before trying again.', 409);
      const readback = await env.DB.prepare(`SELECT revoked_at FROM publisher_grants
        WHERE grant_id = ? AND account_user_id = ?`).bind(grantId, session.user.id).first<{ revoked_at: number | null }>();
      if (readback?.revoked_at !== now) return html('Revocation was not confirmed by readback.', 503);
    } catch { return html('Publisher grant storage refused the revocation.', 503); }
    return redirect(`/account/publisher-grants?repo=${encodeURIComponent(repo)}&revoked=1`);
  }
  return html('Unknown publisher-grant action.', 404);
}
