/**
 * apps/relay/src/work-register.ts — the Harbor Work Register: one shared board
 * telling every agent working a repository who is on what, right now.
 *
 * WHY THIS IS NOT A SECOND ROADMAP, stated first because the distinction is
 * the design and it is the one this repository keeps losing:
 *
 *   The REGISTRY says what work EXISTS. That is `roadmap_items` in the daemon,
 *   projected append-only to `docs/roadmap/roadmap.snapshot.json`. This Worker
 *   never writes it. It reads it — through the signed-in operator's own GitHub
 *   token, from the repo, at the default branch — and caches what it read with
 *   the ref and the moment stamped on it.
 *
 *   The REGISTER says who HOLDS it. That is `work_claims` and `work_notes`,
 *   and nothing else. A row here is a claim over a slug; it is not the slug's
 *   existence. That is exactly the Claim/roadmap-item distinction the Book
 *   draws, and drawing it is what keeps a coordination record from quietly
 *   becoming a fourth constitution.
 *
 * The practical payoff: with the daemon halted, the registry cannot be written
 * and the register still works. Agents coordinate over work already recorded,
 * and a slug an agent proposes that has no row is stored as `proposed` —
 * visibly second-class, and the same queue `docs/roadmap/unregistered.json`
 * counts in the tree, kept here so the count survives the halt.
 *
 * HONESTY (repo law: no Potemkin). The ENFORCEMENT point is cooperative. This
 * Worker refuses a second claim on a held slug and says who holds it; it
 * cannot stop an agent that never asks. That is the same shape as the SITREP
 * dial in repo-settings-page.ts — the server is the account-of-record for
 * intent, the local harness is what obeys — and the page says so rather than
 * implying the register reaches into anybody's checkout.
 *
 * Auth: the page is session + GitHub repo ACL (you may read a board only for a
 * repository your GitHub identity can read). The JSON paths additionally
 * accept a `pdu_` device bearer, which is how an agent authenticates without
 * carrying a GitHub credential of its own — and why the registry projection is
 * cached rather than fetched per request.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import { resolveUserFromRequest } from './device-flow.js';
import { fetchRepoFile } from './github-app.js';
import { HEAD, TOKENS } from './account-page.js';

/** Where the committed registry projection lives in a repository. */
export const SNAPSHOT_PATH = 'docs/roadmap/roadmap.snapshot.json';

/**
 * How long a claim may go without a heartbeat before the next agent to ask is
 * offered it as salvage. Forty-five minutes is chosen to be longer than a slow
 * turn and much shorter than a working day: a claim that outlives its agent
 * must not block the work until a human notices, and an agent that is merely
 * thinking hard must not lose its claim mid-thought.
 */
export const CLAIM_STALE_AFTER_SECONDS = 45 * 60;

export type ClaimState = 'open' | 'held' | 'blocked' | 'review' | 'done' | 'abandoned';
export type Provenance = 'registered' | 'proposed';
export type AgentKind = 'session' | 'human' | 'fleet';

const CLAIM_STATES: ClaimState[] = ['open', 'held', 'blocked', 'review', 'done', 'abandoned'];
const AGENT_KINDS: AgentKind[] = ['session', 'human', 'fleet'];

/** A claim as stored. Times are unix seconds on the relay clock. */
export interface ClaimRow {
  slug: string;
  provenance: Provenance;
  state: ClaimState;
  agent: string | null;
  agent_kind: AgentKind | null;
  headline: string;
  branch: string | null;
  pr_number: number | null;
  claimed_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

/** One row of the registry projection as cached. */
export interface RegistryRow {
  slug: string;
  status: string;
  kind: string;
  priority: number | null;
  summary: string;
}

/** What the cache knows about its own freshness. Never hidden from a reader. */
export interface CacheMeta {
  ref: string;
  path: string;
  read_at: number;
  item_count: number;
}

/** A board row: the registry's view of a slug joined to who holds it. */
export interface BoardRow extends Partial<RegistryRow> {
  slug: string;
  claim: ClaimRow | null;
  /** True when the claim's holder has gone quiet past the TTL. */
  stale: boolean;
}

const now = (): number => Math.floor(Date.now() / 1000);

/** A claim is salvageable when it is held and its holder stopped reporting. */
export function isStale(claim: ClaimRow | null, at: number = now()): boolean {
  if (!claim || claim.state === 'open' || claim.state === 'done' || claim.state === 'abandoned') {
    return false;
  }
  const beat = claim.heartbeat_at ?? claim.claimed_at;
  if (beat === null) return false;
  return at - beat > CLAIM_STALE_AFTER_SECONDS;
}

/** `owner/name` split, rejecting anything that is not exactly two segments. */
export function splitRepo(full: string | null): { owner: string; repo: string } | null {
  if (!full) return null;
  const parts = full.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  // Each segment must START alphanumeric, which is GitHub's own rule and also
  // what keeps "." and ".." out: a dot-leading segment is a relative path, and
  // this value is interpolated into a GitHub API URL. A plain character class
  // admits "../etc" as {owner: "..", repo: "etc"}, which is a traversal shape
  // reaching an upstream we do not control. Refuse it here.
  const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  if (owner.length > 100 || repo.length > 100) return null;
  return { owner, repo };
}

/**
 * Slugs are the join key between the register and the registry, so the shape
 * accepted here must be the shape the registry uses. Anything else would let a
 * claim exist that can never match a row.
 */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{3,}$/.test(value);
}

// ── the registry projection, read from the repo and cached ─────────────────

/**
 * Parse the committed snapshot. It has been written two ways over its life (a
 * bare array, and an object with an `items` key), so both are accepted; a
 * shape that yields no slugs is an error rather than an empty board, because
 * an empty registry would make every slug look unregistered — a loud wrong
 * answer, but still a wrong answer.
 */
export function parseSnapshot(text: string): RegistryRow[] {
  const data = JSON.parse(text) as unknown;
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown[]; roadmap_items?: unknown[] })?.items ??
       (data as { roadmap_items?: unknown[] })?.roadmap_items ??
       []);
  if (!Array.isArray(items)) throw new Error('snapshot has no item array');
  const rows: RegistryRow[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const slug = String(item.slug ?? item.id ?? '').trim();
    if (!slug) continue;
    rows.push({
      slug,
      status: String(item.status ?? ''),
      kind: String(item.kind ?? ''),
      priority: typeof item.priority === 'number' ? item.priority : null,
      summary: String(item.summary_md ?? item.summary ?? item.title ?? ''),
    });
  }
  if (rows.length === 0) throw new Error('snapshot parsed to zero items');
  return rows;
}

/**
 * Read the snapshot from the repo through the operator's own token and replace
 * the cache with what it says. Replace, not merge: the projection is
 * append-only upstream but a slug removed from it must not survive here as a
 * ghost the board still offers.
 */
export async function refreshRegistryCache(
  env: Env,
  userId: string,
  repoFullName: string,
  ghToken: string,
  ref = 'main',
): Promise<CacheMeta> {
  const parts = splitRepo(repoFullName);
  if (!parts) throw new Error('repo must be owner/name');
  const text = await fetchRepoFile(parts.owner, parts.repo, SNAPSHOT_PATH, ref, ghToken);
  if (text === null) throw new Error(`${SNAPSHOT_PATH} not readable at ${ref}`);
  const rows = parseSnapshot(text);
  const at = now();

  const statements = [
    env.DB.prepare(
      'DELETE FROM work_registry_cache WHERE user_id = ? AND repo_full_name = ?',
    ).bind(userId, repoFullName),
    ...rows.map((r) =>
      env.DB.prepare(
        `INSERT INTO work_registry_cache
           (user_id, repo_full_name, slug, status, kind, priority, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, repoFullName, r.slug, r.status, r.kind, r.priority, r.summary),
    ),
    env.DB.prepare(
      `INSERT INTO work_registry_cache_meta
         (user_id, repo_full_name, ref, path, read_at, item_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
         ref = excluded.ref, path = excluded.path,
         read_at = excluded.read_at, item_count = excluded.item_count`,
    ).bind(userId, repoFullName, ref, SNAPSHOT_PATH, at, rows.length),
  ];
  await env.DB.batch(statements);
  return { ref, path: SNAPSHOT_PATH, read_at: at, item_count: rows.length };
}

export async function readCacheMeta(
  env: Env,
  userId: string,
  repoFullName: string,
): Promise<CacheMeta | null> {
  const row = await env.DB.prepare(
    `SELECT ref, path, read_at, item_count FROM work_registry_cache_meta
      WHERE user_id = ? AND repo_full_name = ?`,
  )
    .bind(userId, repoFullName)
    .first<CacheMeta>();
  return row ?? null;
}

// ── the board ──────────────────────────────────────────────────────────────

/**
 * Every slug the registry cache carries, left-joined to its claim, plus every
 * claim whose slug the cache does not carry (the proposed queue). One query
 * each rather than one per slug: the board is read on every agent turn.
 */
export async function readBoard(
  env: Env,
  userId: string,
  repoFullName: string,
): Promise<BoardRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.slug        AS slug,
            r.status      AS status,
            r.kind        AS kind,
            r.priority    AS priority,
            r.summary     AS summary,
            c.provenance  AS c_provenance,
            c.state       AS c_state,
            c.agent       AS c_agent,
            c.agent_kind  AS c_agent_kind,
            c.headline    AS c_headline,
            c.branch      AS c_branch,
            c.pr_number   AS c_pr_number,
            c.claimed_at  AS c_claimed_at,
            c.heartbeat_at AS c_heartbeat_at,
            c.finished_at AS c_finished_at,
            c.updated_at  AS c_updated_at
       FROM work_registry_cache r
       LEFT JOIN work_claims c
         ON c.user_id = r.user_id AND c.repo_full_name = r.repo_full_name AND c.slug = r.slug
      WHERE r.user_id = ? AND r.repo_full_name = ?
      UNION ALL
     SELECT c.slug, NULL, NULL, NULL, NULL,
            c.provenance, c.state, c.agent, c.agent_kind, c.headline, c.branch,
            c.pr_number, c.claimed_at, c.heartbeat_at, c.finished_at, c.updated_at
       FROM work_claims c
      WHERE c.user_id = ? AND c.repo_full_name = ?
        AND NOT EXISTS (
          SELECT 1 FROM work_registry_cache r
           WHERE r.user_id = c.user_id AND r.repo_full_name = c.repo_full_name
             AND r.slug = c.slug)`,
  )
    .bind(userId, repoFullName, userId, repoFullName)
    .all<Record<string, unknown>>();

  const at = now();
  return (results ?? []).map((row) => {
    const claim: ClaimRow | null =
      row.c_state === null || row.c_state === undefined
        ? null
        : {
            slug: String(row.slug),
            provenance: (row.c_provenance as Provenance) ?? 'registered',
            state: row.c_state as ClaimState,
            agent: (row.c_agent as string | null) ?? null,
            agent_kind: (row.c_agent_kind as AgentKind | null) ?? null,
            headline: String(row.c_headline ?? ''),
            branch: (row.c_branch as string | null) ?? null,
            pr_number: (row.c_pr_number as number | null) ?? null,
            claimed_at: (row.c_claimed_at as number | null) ?? null,
            heartbeat_at: (row.c_heartbeat_at as number | null) ?? null,
            finished_at: (row.c_finished_at as number | null) ?? null,
            updated_at: Number(row.c_updated_at ?? 0),
          };
    return {
      slug: String(row.slug),
      status: row.status === null || row.status === undefined ? undefined : String(row.status),
      kind: row.kind === null || row.kind === undefined ? undefined : String(row.kind),
      priority: (row.priority as number | null) ?? undefined,
      summary: row.summary === null || row.summary === undefined ? undefined : String(row.summary),
      claim,
      stale: isStale(claim, at),
    };
  });
}

export async function readClaim(
  env: Env,
  userId: string,
  repoFullName: string,
  slug: string,
): Promise<ClaimRow | null> {
  const row = await env.DB.prepare(
    `SELECT slug, provenance, state, agent, agent_kind, headline, branch, pr_number,
            claimed_at, heartbeat_at, finished_at, updated_at
       FROM work_claims
      WHERE user_id = ? AND repo_full_name = ? AND slug = ?`,
  )
    .bind(userId, repoFullName, slug)
    .first<ClaimRow>();
  return row ?? null;
}

export async function readNotes(
  env: Env,
  userId: string,
  repoFullName: string,
  slug: string,
  limit = 50,
): Promise<Array<{ at: number; agent: string; kind: string; body: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT at, agent, kind, body FROM work_notes
      WHERE user_id = ? AND repo_full_name = ? AND slug = ?
      ORDER BY at DESC LIMIT ?`,
  )
    .bind(userId, repoFullName, slug, limit)
    .all<{ at: number; agent: string; kind: string; body: string }>();
  return results ?? [];
}

async function appendNote(
  env: Env,
  userId: string,
  repoFullName: string,
  slug: string,
  agent: string,
  kind: string,
  body: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO work_notes (id, user_id, repo_full_name, slug, at, agent, kind, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, repoFullName, slug, now(), agent, kind, body)
    .run();
}

// ── claiming: the refusal is the coordination ──────────────────────────────

export type ClaimOutcome =
  | { ok: true; claim: ClaimRow; salvaged: boolean }
  | { ok: false; reason: 'held'; claim: ClaimRow };

/**
 * Take a slug, or be told who has it.
 *
 * The whole point of the register is this function returning `held`: an agent
 * that asks and is refused goes and does something else, which is cheaper than
 * two agents discovering the collision in a merge. The compare-and-set is done
 * in the UPDATE's WHERE clause rather than by reading and then writing, so two
 * agents racing on the same slug cannot both see `open`.
 *
 * A claim whose holder has gone quiet past the TTL is offered as salvage, and
 * the taking is recorded as `salvaged` rather than `claimed` — the next reader
 * of the thread should be able to tell "picked up abandoned work" from "was
 * handed this", because those two need different amounts of re-checking.
 */
export async function claimSlug(
  env: Env,
  userId: string,
  repoFullName: string,
  slug: string,
  agent: string,
  opts: {
    agentKind?: AgentKind;
    headline?: string;
    branch?: string | null;
    prNumber?: number | null;
    registered: boolean;
  },
): Promise<ClaimOutcome> {
  const at = now();
  const provenance: Provenance = opts.registered ? 'registered' : 'proposed';
  const kind = opts.agentKind ?? 'session';
  const headline = opts.headline ?? '';
  const staleBefore = at - CLAIM_STALE_AFTER_SECONDS;

  // One statement decides it. The row is taken when it does not exist, when it
  // is open or abandoned, when this same agent already holds it (a re-claim is
  // idempotent, which matters because an agent that lost its reply must be
  // able to ask again), or when the holder has gone quiet.
  const res = await env.DB.prepare(
    `INSERT INTO work_claims
       (user_id, repo_full_name, slug, provenance, state, agent, agent_kind,
        headline, branch, pr_number, claimed_at, heartbeat_at, updated_at)
     VALUES (?, ?, ?, ?, 'held', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, repo_full_name, slug) DO UPDATE SET
       state        = 'held',
       agent        = excluded.agent,
       agent_kind   = excluded.agent_kind,
       headline     = CASE WHEN excluded.headline <> '' THEN excluded.headline
                           ELSE work_claims.headline END,
       branch       = COALESCE(excluded.branch, work_claims.branch),
       pr_number    = COALESCE(excluded.pr_number, work_claims.pr_number),
       claimed_at   = CASE WHEN work_claims.agent = excluded.agent
                           THEN work_claims.claimed_at ELSE excluded.claimed_at END,
       heartbeat_at = excluded.heartbeat_at,
       updated_at   = excluded.updated_at
     WHERE work_claims.state IN ('open', 'abandoned')
        OR work_claims.agent = excluded.agent
        OR COALESCE(work_claims.heartbeat_at, work_claims.claimed_at, 0) < ?`,
  )
    .bind(
      userId, repoFullName, slug, provenance, agent, kind, headline,
      opts.branch ?? null, opts.prNumber ?? null, at, at, at, staleBefore,
    )
    .run();

  const changed = (res.meta?.changes ?? 0) > 0;
  const after = await readClaim(env, userId, repoFullName, slug);
  if (!changed || !after) {
    // The WHERE guard rejected it: somebody else holds it and is still alive.
    return { ok: false, reason: 'held', claim: after as ClaimRow };
  }
  const salvaged = after.claimed_at !== null && after.claimed_at < at && after.agent === agent
    && after.claimed_at !== at;
  await appendNote(
    env, userId, repoFullName, slug, agent,
    salvaged ? 'salvaged' : 'claimed',
    headline,
  );
  return { ok: true, claim: after, salvaged };
}

/** Only the holder may change a claim; anyone else gets a refusal, not a write. */
async function mutateAsHolder(
  env: Env,
  userId: string,
  repoFullName: string,
  slug: string,
  agent: string,
  set: string,
  binds: unknown[],
): Promise<ClaimRow | null> {
  const res = await env.DB.prepare(
    `UPDATE work_claims SET ${set}, updated_at = ?
      WHERE user_id = ? AND repo_full_name = ? AND slug = ? AND agent = ?`,
  )
    .bind(...binds, now(), userId, repoFullName, slug, agent)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return null;
  return readClaim(env, userId, repoFullName, slug);
}

export async function heartbeat(
  env: Env, userId: string, repoFullName: string, slug: string, agent: string,
): Promise<ClaimRow | null> {
  return mutateAsHolder(env, userId, repoFullName, slug, agent, 'heartbeat_at = ?', [now()]);
}

export async function setState(
  env: Env, userId: string, repoFullName: string, slug: string, agent: string,
  state: ClaimState, body = '',
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, userId, repoFullName, slug, agent,
    'state = ?, heartbeat_at = ?', [state, now()],
  );
  if (row) await appendNote(env, userId, repoFullName, slug, agent, 'state', `${state}${body ? `: ${body}` : ''}`);
  return row;
}

/**
 * Give it back. A release without a note is the thing the register exists to
 * prevent — the next agent inherits a slug and no reason — so the note is
 * written unconditionally and the caller's words go in it when there are any.
 */
export async function releaseSlug(
  env: Env, userId: string, repoFullName: string, slug: string, agent: string, body = '',
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, userId, repoFullName, slug, agent,
    "state = 'open', agent = NULL, agent_kind = NULL, heartbeat_at = NULL", [],
  );
  if (row) await appendNote(env, userId, repoFullName, slug, agent, 'released', body);
  return row;
}

export async function finishSlug(
  env: Env, userId: string, repoFullName: string, slug: string, agent: string,
  body = '', prNumber?: number | null,
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, userId, repoFullName, slug, agent,
    "state = 'done', finished_at = ?, pr_number = COALESCE(?, pr_number)",
    [now(), prNumber ?? null],
  );
  if (row) await appendNote(env, userId, repoFullName, slug, agent, 'finished', body);
  return row;
}

export async function note(
  env: Env, userId: string, repoFullName: string, slug: string, agent: string, body: string,
): Promise<void> {
  await appendNote(env, userId, repoFullName, slug, agent, 'note', body);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * Who is asking, and may they see this repository's board?
 *
 * A session carries a GitHub token, so it is checked against the live repo ACL
 * and may refresh the registry cache. A `pdu_` device bearer carries no GitHub
 * credential, so it is admitted only to a repository whose board this account
 * has already opened — which is what the cache row proves. An agent therefore
 * cannot use its device token to discover repositories the operator never
 * brought here.
 */
async function authorize(
  request: Request,
  env: Env,
  repoFullName: string,
): Promise<
  | { ok: true; userId: string; ghToken: string | null; agentDefault: string }
  | { ok: false; response: Response }
> {
  const parts = splitRepo(repoFullName);
  if (!parts) return { ok: false, response: json({ error: 'repo must be owner/name' }, 400) };

  const session = await resolveSession(request, env);
  if (session) {
    const allowed = await userCanReadRepo(env, session, parts.owner, parts.repo);
    if (!allowed) return { ok: false, response: json({ error: 'no access to that repository' }, 403) };
    return {
      ok: true,
      userId: session.user.id,
      ghToken: session.ghToken ?? null,
      agentDefault: session.user.login ? `@${session.user.login}` : 'operator',
    };
  }

  const user: UserRow | null = await resolveUserFromRequest(request, env);
  if (!user) return { ok: false, response: json({ error: 'sign in, or send a pdu_ bearer' }, 401) };
  const opened = await readCacheMeta(env, user.id, repoFullName);
  if (!opened) {
    return {
      ok: false,
      response: json(
        { error: 'this account has not opened a board for that repository yet; sign in at /account/register once' },
        403,
      ),
    };
  }
  return { ok: true, userId: user.id, ghToken: null, agentDefault: 'agent' };
}

/** Is this slug one the registry admitted? Decides `registered` vs `proposed`. */
async function isRegistered(
  env: Env, userId: string, repoFullName: string, slug: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM work_registry_cache WHERE user_id = ? AND repo_full_name = ? AND slug = ?',
  )
    .bind(userId, repoFullName, slug)
    .first<{ ok: number }>();
  return Boolean(row);
}

/**
 * The JSON surface, under `/v1/register/...`. Every path takes `repo=owner/name`.
 *
 *   GET  /v1/register/board      every slug, its claim, and the cache's own age
 *   GET  /v1/register/available  the subset nothing holds — what to ask for
 *   GET  /v1/register/item       one slug with its note thread
 *   POST /v1/register/claim      take it, or be told who has it (409)
 *   POST /v1/register/heartbeat  still working; resets the salvage clock
 *   POST /v1/register/state      blocked / review / held, with a reason
 *   POST /v1/register/note       leave the next agent what the diff cannot say
 *   POST /v1/register/release    give it back, with why
 *   POST /v1/register/finish     done, with the PR that carries it
 *   POST /v1/register/refresh    re-read the registry projection (session only)
 */
export async function handleRegisterApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/v1\/register\/?/, '') || 'board';
  const repoFullName = url.searchParams.get('repo') ?? '';

  const auth = await authorize(request, env, repoFullName);
  if (!auth.ok) return auth.response;
  const { userId, ghToken, agentDefault } = auth;

  if (request.method === 'GET') {
    const meta = await readCacheMeta(env, userId, repoFullName);
    if (action === 'board' || action === 'available') {
      const rows = await readBoard(env, userId, repoFullName);
      const board =
        action === 'available'
          ? rows.filter((r) => !r.claim || r.claim.state === 'open' || r.claim.state === 'abandoned' || r.stale)
          : rows;
      return json({ repo: repoFullName, registry: meta, count: board.length, items: board });
    }
    if (action === 'item') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!isSlug(slug)) return json({ error: 'slug required' }, 400);
      const claim = await readClaim(env, userId, repoFullName, slug);
      const notes = await readNotes(env, userId, repoFullName, slug);
      return json({ repo: repoFullName, slug, registry: meta, claim, stale: isStale(claim), notes });
    }
    return json({ error: `unknown action ${action}` }, 404);
  }

  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }

  if (action === 'refresh') {
    if (!ghToken) return json({ error: 'refreshing the registry needs a signed-in session' }, 403);
    try {
      const meta = await refreshRegistryCache(env, userId, repoFullName, ghToken);
      return json({ repo: repoFullName, registry: meta });
    } catch (err) {
      return json({ error: `could not read the registry projection: ${(err as Error).message}` }, 502);
    }
  }

  const slug = String(body.slug ?? '');
  if (!isSlug(slug)) return json({ error: 'slug must be a registry-shaped slug' }, 400);
  const agent = String(body.agent ?? agentDefault).slice(0, 120) || agentDefault;
  const text = String(body.body ?? body.note ?? '').slice(0, 4000);

  switch (action) {
    case 'claim': {
      const registered = await isRegistered(env, userId, repoFullName, slug);
      const kindRaw = String(body.agent_kind ?? 'session');
      const outcome = await claimSlug(env, userId, repoFullName, slug, agent, {
        agentKind: AGENT_KINDS.includes(kindRaw as AgentKind) ? (kindRaw as AgentKind) : 'session',
        headline: String(body.headline ?? '').slice(0, 300),
        branch: body.branch === undefined ? null : String(body.branch).slice(0, 300),
        prNumber: typeof body.pr_number === 'number' ? body.pr_number : null,
        registered,
      });
      if (!outcome.ok) {
        return json(
          {
            error: 'held',
            slug,
            held_by: outcome.claim?.agent ?? null,
            since: outcome.claim?.claimed_at ?? null,
            headline: outcome.claim?.headline ?? '',
            hint: 'ask for something else, or wait for the holder to release it',
          },
          409,
        );
      }
      return json({
        slug,
        claim: outcome.claim,
        salvaged: outcome.salvaged,
        provenance: outcome.claim.provenance,
        note:
          outcome.claim.provenance === 'proposed'
            ? 'this slug has no row in the registry projection; it is queued, not scheduled'
            : undefined,
      });
    }
    case 'heartbeat': {
      const row = await heartbeat(env, userId, repoFullName, slug, agent);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'state': {
      const state = String(body.state ?? '');
      if (!CLAIM_STATES.includes(state as ClaimState)) return json({ error: 'unknown state' }, 400);
      const row = await setState(env, userId, repoFullName, slug, agent, state as ClaimState, text);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'note': {
      if (!text) return json({ error: 'a note needs a body' }, 400);
      await note(env, userId, repoFullName, slug, agent, text);
      return json({ slug, ok: true });
    }
    case 'release': {
      const row = await releaseSlug(env, userId, repoFullName, slug, agent, text);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'finish': {
      const pr = typeof body.pr_number === 'number' ? body.pr_number : null;
      const row = await finishSlug(env, userId, repoFullName, slug, agent, text, pr);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    default:
      return json({ error: `unknown action ${action}` }, 404);
  }
}

// ── the page ───────────────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ago = (at: number | null): string => {
  if (!at) return '—';
  const d = now() - at;
  if (d < 90) return 'just now';
  if (d < 5400) return `${Math.round(d / 60)} min ago`;
  if (d < 172800) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
};

const CSS = `${TOKENS}
.page{max-width:1180px;margin:0 auto;padding:28px 32px 96px}
header.h{border-bottom:2px solid var(--border-strong);padding-bottom:16px;margin-bottom:6px}
h1{font-size:30px;margin-bottom:6px}
.lede{max-width:66ch;color:var(--text-secondary)}
.meta{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--text-muted);margin-top:10px}
.stale{color:var(--error);font-weight:600}
table{border-collapse:collapse;width:100%;font-size:14px;margin-top:18px}
.wrap{overflow-x:auto}
th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);
   font-weight:600;padding:6px 10px 6px 0;border-bottom:1px solid var(--border-strong)}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--hair);vertical-align:top}
td.slug{font-family:"IBM Plex Mono",monospace;font-size:12.5px;white-space:nowrap}
.pill{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.06em;
      text-transform:uppercase;padding:2px 8px;white-space:nowrap}
.s-held{background:var(--cobalt);color:var(--on-accent)}
.s-open{background:var(--surface-strong);color:var(--text-secondary)}
.s-blocked{background:var(--violet);color:var(--on-accent)}
.s-review{background:var(--amber);color:var(--on-accent)}
.s-done{background:var(--health);color:var(--on-accent)}
.s-abandoned{background:var(--rust);color:var(--on-accent)}
.prop{border-left:3px solid var(--amber);padding-left:8px}
.note{border:1px solid var(--border-strong);background:var(--surface-raised);padding:14px 18px;margin:18px 0;max-width:78ch}
.note b{color:var(--text-primary)}
code{font-size:.92em}`;

const shell = (title: string, inner: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head>${HEAD}<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page">${inner}</div></body></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // Script-free by construction, like every other page in this Worker.
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'",
      },
    },
  );

/**
 * GET /account/register?repo=owner/name — the board, server-rendered.
 *
 * Opening the page also refreshes the registry cache, which is what lets an
 * agent on a device token read a current board without a GitHub credential:
 * the operator's own visit is the refresh. The page prints when that last
 * happened rather than implying the list is live.
 */
export async function handleRegisterPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return new Response(null, { status: 302, headers: { Location: '/login' } });

  const url = new URL(request.url);
  const repoFullName = url.searchParams.get('repo') ?? '';
  const parts = splitRepo(repoFullName);
  if (!parts) {
    return shell(
      'Harbor Work Register',
      `<header class="h"><h1>The Harbor Work Register</h1>
       <p class="lede">Name a repository to open its board.</p></header>
       <p class="meta">Add <code>?repo=owner/name</code> to this URL.</p>`,
    );
  }
  if (!(await userCanReadRepo(env, session, parts.owner, parts.repo))) {
    return shell('Harbor Work Register', '<header class="h"><h1>No access</h1></header>');
  }

  let refreshError = '';
  if (session.ghToken) {
    try {
      await refreshRegistryCache(env, session.user.id, repoFullName, session.ghToken);
    } catch (err) {
      refreshError = (err as Error).message;
    }
  }
  const meta = await readCacheMeta(env, session.user.id, repoFullName);
  const rows = await readBoard(env, session.user.id, repoFullName);
  rows.sort((a, b) => {
    const rank = (r: BoardRow) => (r.claim && r.claim.state !== 'open' && r.claim.state !== 'done' ? 0 : r.claim?.state === 'done' ? 2 : 1);
    return rank(a) - rank(b) || a.slug.localeCompare(b.slug);
  });

  const body = rows
    .map((r) => {
      const c = r.claim;
      const state = c?.state ?? 'open';
      const prov = c?.provenance === 'proposed';
      return `<tr>
        <td class="slug${prov ? ' prop' : ''}">${esc(r.slug)}</td>
        <td><span class="pill s-${esc(state)}">${esc(state)}</span>${r.stale ? ' <span class="stale">stale</span>' : ''}</td>
        <td>${esc(c?.agent ?? '')}</td>
        <td>${esc(c?.headline || r.summary || '')}</td>
        <td class="mono">${c?.pr_number ? `#${c.pr_number}` : ''}</td>
        <td class="mono">${esc(ago(c?.heartbeat_at ?? c?.claimed_at ?? null))}</td>
      </tr>`;
    })
    .join('');

  const held = rows.filter((r) => r.claim && r.claim.state === 'held').length;
  const proposed = rows.filter((r) => r.claim?.provenance === 'proposed').length;

  return shell(
    'Harbor Work Register',
    `<header class="h">
      <h1>The Harbor Work Register</h1>
      <p class="lede">Who is on what, in <code>${esc(repoFullName)}</code>, right now. The registry says what work
      exists; this board says who holds it. A claim refused is the coordination working.</p>
      <p class="meta">${rows.length} slug(s) · ${held} held · ${proposed} proposed ·
      registry read ${meta ? `${esc(ago(meta.read_at))} from <code>${esc(meta.path)}</code> at <code>${esc(meta.ref)}</code> (${meta.item_count} rows)` : 'never'}
      ${refreshError ? `· <span class="stale">refresh failed: ${esc(refreshError)}</span>` : ''}</p>
    </header>
    <div class="note"><b>This board is cooperative.</b> It refuses a second claim on a held slug and tells you who
    holds it; it cannot stop an agent that never asks. The enforcement point is each agent's own harness, and the
    contract it reads is in <code>AGENTS.md</code>. A slug marked <b>proposed</b> has no row in the registry
    projection — it is queued, not scheduled, and draining that queue is the first thing to do when the roadmap
    authority comes back.</div>
    <div class="wrap"><table>
      <tr><th>Slug</th><th>State</th><th>Agent</th><th>What</th><th>PR</th><th>Last heard</th></tr>
      ${body || '<tr><td colspan="6">Nothing on the board yet.</td></tr>'}
    </table></div>`,
  );
}
