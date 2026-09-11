/**
 * apps/relay/src/work-register.ts — the Harbor Work Register: one shared board
 * telling every agent working a repository who is on what, right now.
 *
 * WHY THIS IS NOT A SECOND ROADMAP, stated first because the distinction is
 * the design and it is the one this repository keeps losing:
 *
 *   The REGISTRY says what work EXISTS. That is `roadmap_items` in the daemon.
 *   This Worker never writes it. It READS a replica of it: `roadmap_mirror_*`,
 *   which the daemon pushes here itself with `pd roadmap push`, carrying the
 *   daemon's own clock so a reader can always tell how old the list is.
 *
 *   The REGISTER says who HOLDS it. That is `work_claims` and `work_notes`,
 *   and nothing else. A row here is a claim over a slug; it is not the slug's
 *   existence. That is exactly the Claim/roadmap-item distinction the Book
 *   draws, and drawing it is what keeps a coordination record from quietly
 *   becoming a fourth constitution.
 *
 * The practical payoff: with the daemon halted, the registry cannot be written
 * and the register still works, because what it reads is a replica already
 * sitting in D1 rather than a live call to anything. Agents coordinate over
 * work already recorded, and a slug an agent proposes that has no row is stored
 * as `proposed` — visibly second-class, and the same queue
 * `docs/roadmap/unregistered.json` counts in the tree, kept here so the count
 * survives the halt.
 *
 * HONESTY (repo law: no Potemkin). The ENFORCEMENT point is cooperative. This
 * Worker refuses a second claim on a held slug and says who holds it; it
 * cannot stop an agent that never asks. That is the same shape as the SITREP
 * dial in repo-settings-page.ts — the server is the account-of-record for
 * intent, the local harness is what obeys — and the page says so rather than
 * implying the register reaches into anybody's checkout.
 *
 * Auth: the page is session + GitHub repo ACL (you may read a board only for a
 * repository your GitHub identity can read). The JSON paths additionally accept
 * a `pdu_` device bearer, which is how an agent authenticates without carrying a
 * GitHub credential of its own — and the reason this Worker reads a replica
 * rather than the repository: an agent holding only a device token has no
 * GitHub credential to read a file with, so a registry that needed one was a
 * registry agents could not see.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import { resolveUserFromRequest } from './device-flow.js';
import { HEAD, TOKENS } from './account-theme.js';

/**
 * How long a claim may go without a heartbeat before the next agent to ask is
 * offered it as salvage. Forty-five minutes is chosen to be longer than a slow
 * turn and much shorter than a working day: a claim that outlives its agent
 * must not block the work until a human notices, and an agent that is merely
 * thinking hard must not lose its claim mid-thought.
 */
export const CLAIM_STALE_AFTER_SECONDS = 45 * 60;

/**
 * How old the registry projection may be before the board says so out loud.
 *
 * Six hours, not forty-five minutes: unlike a claim, the mirrored roadmap has
 * no heartbeat and no agent behind it, and it goes out of date only when
 * somebody records work. A shorter clock would cry stale on a quiet afternoon and
 * teach every reader to ignore the word, which is the failure that matters
 * here — a warning nobody reads is worse than no warning, because it looks
 * like one.
 */
export const REGISTRY_STALE_AFTER_SECONDS = 6 * 60 * 60;

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
  /** Who answers for the work, across every agent that ever holds it. */
  owner: string | null;
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

/**
 * What the registry replica knows about its own freshness. Never hidden.
 *
 * Both clocks, because they answer different questions and one of them used to
 * be the only one available. `generated_at` is the DAEMON's clock in unix ms —
 * when this roadmap was true. `received_at` is the RELAY's, in unix seconds —
 * when it arrived here. The first is the one staleness is measured against; a
 * push that arrived a minute ago carrying a two-week-old export is two weeks
 * stale, and reporting the arrival time would call it fresh.
 */
export interface RegistryMeta {
  harbor: string;
  /** Daemon clock, unix ms. */
  generated_at: number;
  /** Relay clock, unix seconds. */
  received_at: number;
  item_count: number;
  /** Which daemon pushed, display only. Null when the push did not say. */
  daemon_label: string | null;
}

/**
 * The registry replica with its own age attached, which is the only form any
 * caller should ever see it in.
 *
 * A raw timestamp was returned from the first version and nothing looked at it,
 * so a week-old item list rendered exactly like a fresh one. An age nobody
 * reads is not provenance; it is a number in a response. So the age is computed
 * here, once, and every surface — the JSON, the page, an agent's decision about
 * whether to trust the list — reads the same words.
 */
export interface DatedRegistryMeta extends RegistryMeta {
  age_seconds: number;
  age: string;
  stale: boolean;
  /** Lag between the daemon making this snapshot and the relay receiving it. */
  transit_seconds: number;
}

/** A board row: the registry's view of a slug joined to who holds it. */
export interface BoardRow extends Partial<RegistryRow> {
  slug: string;
  claim: ClaimRow | null;
  /** True when the claim's holder has gone quiet past the TTL. */
  stale: boolean;
  /** PRs, ADRs, plans and runs attached to this slug. Absent on /item. */
  links?: WorkLink[];
}

export type BoardOrder = 'priority' | 'updated' | 'slug';
const BOARD_ORDERS: BoardOrder[] = ['priority', 'updated', 'slug'];

/**
 * How a caller asks for a slice of the board.
 *
 * Every field is optional and the defaults reproduce what the surface returned
 * before any of this existed — 300 slugs unordered was fine, and the point of
 * adding order and paging is 3,000, not to change the answer anybody is
 * already reading.
 */
export interface BoardQuery {
  order?: BoardOrder;
  state?: ClaimState;
  agent?: string;
  owner?: string;
  provenance?: Provenance;
  limit?: number;
  cursor?: string;
}

/** Ordering, filtering and paging read off the query string, safely. */
export function parseBoardQuery(params: URLSearchParams): BoardQuery | { error: string } {
  const q: BoardQuery = {};

  const order = params.get('order');
  if (order !== null) {
    if (!(BOARD_ORDERS as string[]).includes(order)) {
      return { error: `order must be one of ${BOARD_ORDERS.join(', ')}` };
    }
    q.order = order as BoardOrder;
  }

  const state = params.get('state');
  if (state !== null) {
    if (!(CLAIM_STATES as string[]).includes(state)) {
      return { error: `state must be one of ${CLAIM_STATES.join(', ')}` };
    }
    q.state = state as ClaimState;
  }

  const provenance = params.get('provenance');
  if (provenance !== null) {
    if (provenance !== 'registered' && provenance !== 'proposed') {
      return { error: 'provenance must be registered or proposed' };
    }
    q.provenance = provenance;
  }

  for (const key of ['agent', 'owner'] as const) {
    const v = params.get(key);
    if (v !== null) {
      if (v.length > 200) return { error: `${key} is too long` };
      q[key] = v;
    }
  }

  const limit = params.get('limit');
  if (limit !== null) {
    const n = Number(limit);
    // Rejected rather than clamped: a caller that asks for 10,000 and silently
    // gets 500 will read the short page as the whole board and stop.
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      return { error: 'limit must be an integer from 1 to 500' };
    }
    q.limit = n;
  }

  const cursor = params.get('cursor');
  if (cursor !== null) {
    if (cursor.length > 300) return { error: 'cursor is not one of ours' };
    q.cursor = cursor;
  }

  return q;
}

/**
 * Apply a query to a board that has already been read.
 *
 * In memory rather than in SQL, deliberately and with a ceiling on it: the
 * board is one repository's slugs — 318 today — and the join that builds it is
 * a UNION the filters cannot push into without being rewritten per filter.
 * Sorting a few hundred rows costs nothing and keeps one code path. If a board
 * ever reaches the tens of thousands this becomes wrong, and the honest signal
 * for that is `total` in the response outgrowing what any page returns.
 *
 * The cursor is the slug last returned under the current order — not an index,
 * which would skip or repeat rows when the board changes between pages.
 */
export function applyBoardQuery(
  rows: BoardRow[],
  q: BoardQuery,
): { items: BoardRow[]; total: number; next_cursor: string | null } {
  let items = rows;

  if (q.state) items = items.filter((r) => (r.claim?.state ?? 'open') === q.state);
  if (q.provenance) items = items.filter((r) => (r.claim?.provenance ?? 'registered') === q.provenance);
  if (q.agent) items = items.filter((r) => r.claim?.agent === q.agent);
  if (q.owner) items = items.filter((r) => r.claim?.owner === q.owner);

  const order = q.order ?? 'updated';
  const byBusy = (r: BoardRow) =>
    r.claim && r.claim.state !== 'open' && r.claim.state !== 'done' ? 0 : r.claim?.state === 'done' ? 2 : 1;
  items = [...items].sort((a, b) => {
    if (order === 'slug') return a.slug.localeCompare(b.slug);
    if (order === 'priority') {
      // The registry's own priority, which the board was throwing away. A slug
      // the projection does not rank sorts after every ranked one rather than
      // ahead of them: unranked is unknown, not urgent.
      const pa = a.priority ?? Number.POSITIVE_INFINITY;
      const pb = b.priority ?? Number.POSITIVE_INFINITY;
      return pa - pb || a.slug.localeCompare(b.slug);
    }
    // 'updated' — the pre-existing order: what is being worked on, first.
    return byBusy(a) - byBusy(b) || a.slug.localeCompare(b.slug);
  });

  const total = items.length;
  if (q.cursor) {
    const from = items.findIndex((r) => r.slug === q.cursor);
    // A cursor whose slug has since left the board pages from the start rather
    // than returning nothing: a caller mid-walk gets duplicates, which it can
    // see, instead of an empty page it would read as "done".
    items = from >= 0 ? items.slice(from + 1) : items;
  }

  let next: string | null = null;
  if (q.limit !== undefined && items.length > q.limit) {
    items = items.slice(0, q.limit);
    next = items[items.length - 1]?.slug ?? null;
  }

  return { items, total, next_cursor: next };
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

/**
 * An age in the words a person would use, so the page and the JSON agree.
 *
 * Rounded down and never precise past the unit that matters: "3 hours ago" is
 * the whole of what a reader does with it, and "3 hours 14 minutes ago" invites
 * them to believe the clock is more meaningful than it is.
 */
export function describeAge(seconds: number): string {
  if (seconds < 0) return 'just now';
  if (seconds < 90) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Attach the replica's age to it. Null in, null out: a board with no mirror at
 * all is a different condition from one with an old mirror, and flattening the
 * two would tell an agent the registry is merely stale when in fact nobody has
 * ever pushed one.
 *
 * Age is measured from `generated_at` — the daemon's clock — and NOT from
 * `received_at`. A push that landed a minute ago carrying a fortnight-old export
 * is a fortnight stale, and measuring arrival would report it as a minute old,
 * which is the exact failure the mirror's two-clock design exists to prevent.
 * `transit_seconds` keeps the other subtraction visible for anyone debugging a
 * pusher, without letting it stand in for freshness.
 */
export function dateRegistryMeta(
  meta: RegistryMeta | null, at: number = now(),
): DatedRegistryMeta | null {
  if (!meta) return null;
  // generated_at is unix MS (daemon), everything else here is unix seconds.
  const generatedSeconds = Math.floor(meta.generated_at / 1000);
  const age = Math.max(0, at - generatedSeconds);
  return {
    ...meta,
    age_seconds: age,
    age: describeAge(age),
    stale: age > REGISTRY_STALE_AFTER_SECONDS,
    transit_seconds: Math.max(0, meta.received_at - generatedSeconds),
  };
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

// ── the registry replica: the relay's own roadmap mirror ───────────────────

/**
 * The roadmap items this account has mirrored for this repository.
 *
 * WHY THE MIRROR AND NOT GITHUB. This read used to fetch
 * `docs/roadmap/roadmap.snapshot.json` from the repository through the
 * signed-in operator's own GitHub token and keep the result in a
 * `work_registry_cache` table of its own. That worked, and it was a second
 * copy of something the relay already stores: `roadmap_mirror_items`, pushed
 * straight from the daemon by `pd roadmap push` (ADR path: the mirror shipped
 * 2026-08-22 with no producer; the producer is `lib/roadmap-mirror-push.ts`).
 *
 * Three things the mirror does better, none of them cosmetic:
 *
 *   * No GitHub credential. An agent holding only a `pdu_` device token could
 *     never populate the cache, so a board nobody had opened in a browser was
 *     empty and every slug looked unregistered. The mirror is already here.
 *   * The daemon's clock. The snapshot only knew when the RELAY read it; the
 *     mirror knows when the DAEMON made it, which is the number staleness
 *     actually means.
 *   * It sees uncommitted work. The snapshot showed main; the daemon's roadmap
 *     is current.
 *
 * ACCOUNT SCOPE, STATED PLAINLY. The mirror is keyed by account — that is its
 * own tenancy invariant and this read does not reach around it. So each
 * operator's board shows the registry THEY pushed, while claims stay shared
 * across the repository. For one operator running many agents (every agent
 * authenticating with that operator's device token) these are the same thing.
 * For two operators on one repository they are not: both see the same claims
 * and each sees their own item list, and a slug one has pushed will read as
 * `proposed` to the other until they push too. That is a real limit, recorded
 * here rather than papered over with a cross-account read the mirror
 * deliberately refuses.
 *
 * @param env - Worker bindings.
 * @param userId - The account whose mirror to read.
 * @param repoFullName - `owner/name`.
 * @returns The registry rows, tombstones excluded — a deleted item is not work
 *   anyone should be offered, though the mirror keeps it queryable.
 */
export async function readRegistryRows(
  env: Env,
  userId: string,
  repoFullName: string,
): Promise<RegistryRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT slug, status, kind, priority, summary_md AS summary
       FROM roadmap_mirror_items
      WHERE user_id = ? AND repo_full_name = ? AND deleted_at IS NULL`,
  )
    .bind(userId, repoFullName)
    .all<RegistryRow>();
  return results ?? [];
}

/**
 * The mirror's own header for this account and repository, or null when this
 * account has never pushed one.
 *
 * Null is a distinct answer from an empty item list: "no push has happened" is
 * the operator's cue to run `pd roadmap push`, and "a push happened and it was
 * empty" is a daemon with no roadmap. Collapsing them would send an operator
 * looking for the wrong fault.
 *
 * @param env - Worker bindings.
 * @param userId - The account whose mirror to read.
 * @param repoFullName - `owner/name`.
 * @returns The header with both clocks, or null.
 */
export async function readRegistryMeta(
  env: Env,
  userId: string,
  repoFullName: string,
): Promise<RegistryMeta | null> {
  const row = await env.DB.prepare(
    `SELECT harbor, generated_at, received_at, item_count, daemon_label
       FROM roadmap_mirrors
      WHERE user_id = ? AND repo_full_name = ?`,
  )
    .bind(userId, repoFullName)
    .first<RegistryMeta>();
  return row ?? null;
}

// ── membership: who may reach this board without a GitHub token ────────────

/**
 * Record that this account reached this board with live GitHub read access.
 *
 * Written on every session request rather than only the first, because
 * `last_seen_at` is how an operator answers "who else is on my board" — and
 * because access revoked upstream should eventually show as a cold row here
 * rather than as a membership that looks freshly granted.
 */
export async function recordMembership(
  env: Env, repoFullName: string, userId: string,
): Promise<void> {
  const at = now();
  await env.DB.prepare(
    `INSERT INTO work_board_members (repo_full_name, user_id, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo_full_name, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(repoFullName, userId, at, at)
    .run();
}

/** Has this account ever opened this board while signed in? */
export async function isMember(
  env: Env, repoFullName: string, userId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM work_board_members WHERE repo_full_name = ? AND user_id = ?',
  )
    .bind(repoFullName, userId)
    .first<{ ok: number }>();
  return Boolean(row);
}

// ── the board ──────────────────────────────────────────────────────────────

/**
 * Every slug this account's mirror carries, left-joined to its claim, plus
 * every claim whose slug the mirror does not carry (the proposed queue). One
 * query rather than one per slug: the board is read on every agent turn.
 *
 * Tombstones drop out of the registry half: a slug the daemon deleted is not
 * work to offer anyone. A claim still HELD on such a slug does not vanish with
 * it — it comes through the union half instead, so the holder stays visible
 * rather than being silently dropped from the board mid-flight. Its
 * `provenance` is the one stored on the claim (`registered`, if that is how it
 * was taken), which is why it does not masquerade as something never
 * registered: it was registered, and then the roadmap moved.
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
            r.summary_md  AS summary,
            c.provenance  AS c_provenance,
            c.state       AS c_state,
            c.agent       AS c_agent,
            c.agent_kind  AS c_agent_kind,
            c.owner       AS c_owner,
            c.headline    AS c_headline,
            c.branch      AS c_branch,
            c.pr_number   AS c_pr_number,
            c.claimed_at  AS c_claimed_at,
            c.heartbeat_at AS c_heartbeat_at,
            c.finished_at AS c_finished_at,
            c.updated_at  AS c_updated_at
       FROM roadmap_mirror_items r
       LEFT JOIN work_claims c
         ON c.repo_full_name = r.repo_full_name AND c.slug = r.slug
      WHERE r.user_id = ? AND r.repo_full_name = ? AND r.deleted_at IS NULL
      UNION ALL
     SELECT c.slug, NULL, NULL, NULL, NULL,
            c.provenance, c.state, c.agent, c.agent_kind, c.owner, c.headline, c.branch,
            c.pr_number, c.claimed_at, c.heartbeat_at, c.finished_at, c.updated_at
       FROM work_claims c
      WHERE c.repo_full_name = ?
        AND NOT EXISTS (
          SELECT 1 FROM roadmap_mirror_items r
           WHERE r.user_id = ? AND r.repo_full_name = c.repo_full_name
             AND r.slug = c.slug AND r.deleted_at IS NULL)`,
  )
    .bind(userId, repoFullName, repoFullName, userId)
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
            owner: (row.c_owner as string | null) ?? null,
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
  repoFullName: string,
  slug: string,
): Promise<ClaimRow | null> {
  const row = await env.DB.prepare(
    `SELECT slug, provenance, state, agent, agent_kind, owner, headline, branch, pr_number,
            claimed_at, heartbeat_at, finished_at, updated_at
       FROM work_claims
      WHERE repo_full_name = ? AND slug = ?`,
  )
    .bind(repoFullName, slug)
    .first<ClaimRow>();
  return row ?? null;
}

export async function readNotes(
  env: Env,
  repoFullName: string,
  slug: string,
  limit = 50,
): Promise<Array<{ at: number; agent: string; kind: string; body: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT at, agent, kind, body FROM work_notes
      WHERE repo_full_name = ? AND slug = ?
      ORDER BY at DESC LIMIT ?`,
  )
    .bind(repoFullName, slug, limit)
    .all<{ at: number; agent: string; kind: string; body: string }>();
  return results ?? [];
}

async function appendNote(
  env: Env,
  repoFullName: string,
  slug: string,
  agent: string,
  kind: string,
  body: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO work_notes (id, repo_full_name, slug, at, agent, kind, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), repoFullName, slug, now(), agent, kind, body)
    .run();
}

// ── links: what else is about this slug ────────────────────────────────────

export type LinkKind = 'pr' | 'issue' | 'doc' | 'adr' | 'run' | 'branch' | 'other';
const LINK_KINDS: LinkKind[] = ['pr', 'issue', 'doc', 'adr', 'run', 'branch', 'other'];

export interface WorkLink {
  kind: LinkKind;
  ref: string;
  title: string;
  added_by: string;
  at: number;
}

export const isLinkKind = (v: unknown): v is LinkKind =>
  typeof v === 'string' && (LINK_KINDS as string[]).includes(v);

/**
 * Attach a document, PR, ADR or run to a slug.
 *
 * Idempotent on (kind, ref) because agents re-post what they know on every
 * turn: a board that grew a row per repetition would bury the thread it exists
 * to summarise. A repeat updates the title, since the later one is usually the
 * better one — a PR gets its real title after it stops being "WIP".
 */
export async function addLink(
  env: Env, repoFullName: string, slug: string,
  kind: LinkKind, ref: string, title: string, addedBy: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO work_links (repo_full_name, slug, kind, ref, title, added_by, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_full_name, slug, kind, ref) DO UPDATE SET
       title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE work_links.title END`,
  )
    .bind(repoFullName, slug, kind, ref, title, addedBy, now())
    .run();
}

export async function readLinks(
  env: Env, repoFullName: string, slug: string,
): Promise<WorkLink[]> {
  const { results } = await env.DB.prepare(
    `SELECT kind, ref, title, added_by, at FROM work_links
      WHERE repo_full_name = ? AND slug = ? ORDER BY at DESC`,
  )
    .bind(repoFullName, slug)
    .all<WorkLink>();
  return results ?? [];
}

/** Every link on a board, grouped by slug, so /board needs one query not N. */
export async function readAllLinks(
  env: Env, repoFullName: string,
): Promise<Map<string, WorkLink[]>> {
  const { results } = await env.DB.prepare(
    `SELECT slug, kind, ref, title, added_by, at FROM work_links
      WHERE repo_full_name = ? ORDER BY at DESC`,
  )
    .bind(repoFullName)
    .all<WorkLink & { slug: string }>();
  const out = new Map<string, WorkLink[]>();
  for (const r of results ?? []) {
    const { slug, ...link } = r;
    const list = out.get(slug);
    if (list) list.push(link);
    else out.set(slug, [link]);
  }
  return out;
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
  repoFullName: string,
  slug: string,
  agent: string,
  opts: {
    agentKind?: AgentKind;
    headline?: string;
    branch?: string | null;
    prNumber?: number | null;
    /** Who answers for the work. Absent leaves any owner already recorded. */
    owner?: string | null;
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
       (repo_full_name, slug, provenance, state, agent, agent_kind, owner,
        headline, branch, pr_number, claimed_at, heartbeat_at, updated_at)
     VALUES (?, ?, ?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_full_name, slug) DO UPDATE SET
       state        = 'held',
       agent        = excluded.agent,
       agent_kind   = excluded.agent_kind,
       -- The owner survives a hand-off: a claim that names none keeps the one
       -- already recorded, so releasing work does not orphan it.
       owner        = COALESCE(excluded.owner, work_claims.owner),
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
      repoFullName, slug, provenance, agent, kind, opts.owner ?? null, headline,
      opts.branch ?? null, opts.prNumber ?? null, at, at, at, staleBefore,
    )
    .run();

  const changed = (res.meta?.changes ?? 0) > 0;
  const after = await readClaim(env, repoFullName, slug);
  if (!changed || !after) {
    // The WHERE guard rejected it: somebody else holds it and is still alive.
    return { ok: false, reason: 'held', claim: after as ClaimRow };
  }
  const salvaged = after.claimed_at !== null && after.claimed_at < at && after.agent === agent
    && after.claimed_at !== at;
  await appendNote(
    env, repoFullName, slug, agent,
    salvaged ? 'salvaged' : 'claimed',
    headline,
  );
  return { ok: true, claim: after, salvaged };
}

/** Only the holder may change a claim; anyone else gets a refusal, not a write. */
async function mutateAsHolder(
  env: Env,
  repoFullName: string,
  slug: string,
  agent: string,
  set: string,
  binds: unknown[],
): Promise<ClaimRow | null> {
  const res = await env.DB.prepare(
    `UPDATE work_claims SET ${set}, updated_at = ?
      WHERE repo_full_name = ? AND slug = ? AND agent = ?`,
  )
    .bind(...binds, now(), repoFullName, slug, agent)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return null;
  return readClaim(env, repoFullName, slug);
}

export async function heartbeat(
  env: Env, repoFullName: string, slug: string, agent: string,
): Promise<ClaimRow | null> {
  return mutateAsHolder(env, repoFullName, slug, agent, 'heartbeat_at = ?', [now()]);
}

export async function setState(
  env: Env, repoFullName: string, slug: string, agent: string,
  state: ClaimState, body = '',
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, repoFullName, slug, agent,
    'state = ?, heartbeat_at = ?', [state, now()],
  );
  if (row) await appendNote(env, repoFullName, slug, agent, 'state', `${state}${body ? `: ${body}` : ''}`);
  return row;
}

/**
 * Give it back. A release without a note is the thing the register exists to
 * prevent — the next agent inherits a slug and no reason — so the note is
 * written unconditionally and the caller's words go in it when there are any.
 */
export async function releaseSlug(
  env: Env, repoFullName: string, slug: string, agent: string, body = '',
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, repoFullName, slug, agent,
    "state = 'open', agent = NULL, agent_kind = NULL, heartbeat_at = NULL", [],
  );
  if (row) await appendNote(env, repoFullName, slug, agent, 'released', body);
  return row;
}

export async function finishSlug(
  env: Env, repoFullName: string, slug: string, agent: string,
  body = '', prNumber?: number | null,
): Promise<ClaimRow | null> {
  const row = await mutateAsHolder(
    env, repoFullName, slug, agent,
    "state = 'done', finished_at = ?, pr_number = COALESCE(?, pr_number)",
    [now(), prNumber ?? null],
  );
  if (row) await appendNote(env, repoFullName, slug, agent, 'finished', body);
  return row;
}

export async function note(
  env: Env, repoFullName: string, slug: string, agent: string, body: string,
): Promise<void> {
  await appendNote(env, repoFullName, slug, agent, 'note', body);
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
 * The board itself is keyed on the repository, so this function answers only
 * the access question — deliberately a different question from occupancy, and
 * kept in a different table, because the first draft of this schema answered
 * both with one key and thereby gave every account its own private board of a
 * shared repository.
 *
 * A session carries a GitHub token, so it is checked against the live repo ACL
 * on every request; passing that check also records membership. A `pdu_` device
 * bearer — what an agent carries — has no GitHub credential to check, so it is
 * admitted only where its account has already passed that check in a browser.
 * An agent therefore cannot use its device token to discover repositories its
 * operator never brought here, while two operators who both have read access
 * work one board rather than two.
 */
async function authorize(
  request: Request,
  env: Env,
  repoFullName: string,
): Promise<
  | { ok: true; userId: string; agentDefault: string }
  | { ok: false; response: Response }
> {
  const parts = splitRepo(repoFullName);
  if (!parts) return { ok: false, response: json({ error: 'repo must be owner/name' }, 400) };

  const session = await resolveSession(request, env);
  if (session) {
    const allowed = await userCanReadRepo(env, session, parts.owner, parts.repo);
    if (!allowed) return { ok: false, response: json({ error: 'no access to that repository' }, 403) };
    await recordMembership(env, repoFullName, session.user.id);
    return {
      ok: true,
      userId: session.user.id,
      agentDefault: session.user.login ? `@${session.user.login}` : 'operator',
    };
  }

  const user: UserRow | null = await resolveUserFromRequest(request, env);
  if (!user) return { ok: false, response: json({ error: 'sign in, or send a pdu_ bearer' }, 401) };
  if (!(await isMember(env, repoFullName, user.id))) {
    // S3, the cold start: the first agent in a fresh repository used to get a
    // bare 403 and no way forward, which reads as a broken register rather than
    // as a step nobody has taken yet. Name the step, and name it the same way
    // the page does, so an agent can put the answer in its own note instead of
    // retrying a refusal it cannot fix on its own.
    return {
      ok: false,
      response: json(
        {
          error: 'no board here yet for this account',
          detail:
            `Nobody signed in to ${repoFullName} has opened this board, so a device token has ` +
            'nothing to be admitted against. An operator with GitHub read access on the ' +
            'repository opens it once, in a browser, and every agent on that repository can ' +
            'reach it from then on.',
          operator_step: `open https://relay.portdaddy.dev/register?repo=${encodeURIComponent(repoFullName)} while signed in with GitHub`,
          repo: repoFullName,
        },
        403,
      ),
    };
  }
  return { ok: true, userId: user.id, agentDefault: 'agent' };
}

/**
 * One sentence about the projection's freshness, or null when there is nothing
 * to say. Returned beside the data rather than instead of it: a stale list is
 * still the best list there is, and refusing to serve it would strand every
 * agent whenever a refresh is overdue.
 */
export function registryWarning(meta: DatedRegistryMeta | null): string | null {
  if (!meta) {
    return 'No roadmap has been mirrored for this repository yet, so every slug an agent names will land in the proposed queue. An operator runs `pd roadmap push` once.';
  }
  if (!meta.stale) return null;
  return `The mirrored roadmap was made by the daemon ${meta.age} (${meta.item_count} items${meta.daemon_label ? `, from ${meta.daemon_label}` : ''}). Work recorded since then is not on this board. An operator runs \`pd roadmap push\`, or an agent treats a missing slug as unknown rather than as absent.`;
}

/** Is this slug one the registry admitted? Decides `registered` vs `proposed`. */
async function isRegistered(
  env: Env, userId: string, repoFullName: string, slug: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM roadmap_mirror_items
      WHERE user_id = ? AND repo_full_name = ? AND slug = ? AND deleted_at IS NULL`,
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
 *   GET  /v1/register/item       one slug with its note thread and its links
 *   POST /v1/register/claim      take it, or be told who has it (409)
 *   POST /v1/register/heartbeat  still working; resets the salvage clock
 *   POST /v1/register/state      blocked / review / held, with a reason
 *   POST /v1/register/note       leave the next agent what the diff cannot say
 *   POST /v1/register/link       attach a PR, ADR, plan or run to a slug
 *   POST /v1/register/release    give it back, with why
 *   POST /v1/register/finish     done, with the PR that carries it
 *   POST /v1/register/refresh    re-read the registry projection (session only)
 *
 * The two list paths take `order` (priority|updated|slug), the filters `state`,
 * `agent`, `owner` and `provenance`, and `limit` with a `cursor` for paging.
 * All optional; omitting them returns exactly what this surface returned before
 * any of them existed, because a query parameter that changes the default
 * answer is a breaking change wearing a feature's clothes.
 */
export async function handleRegisterApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/v1\/register\/?/, '') || 'board';
  const repoFullName = url.searchParams.get('repo') ?? '';

  const auth = await authorize(request, env, repoFullName);
  if (!auth.ok) return auth.response;
  // `userId` is back, and for a reason worth stating: the CLAIMS are keyed on
  // the repository (one shared board for everyone working it), but the REGISTRY
  // half now comes from this account's own roadmap mirror, which is
  // account-scoped by the mirror's own tenancy rule. So the two halves of a
  // board row have different scopes on purpose, and the handler needs both keys.
  const { userId, agentDefault } = auth;

  if (request.method === 'GET') {
    const meta = dateRegistryMeta(await readRegistryMeta(env, userId, repoFullName));
    if (action === 'board' || action === 'available') {
      const q = parseBoardQuery(url.searchParams);
      if ('error' in q) return json({ error: q.error }, 400);
      const rows = await readBoard(env, userId, repoFullName);
      const links = await readAllLinks(env, repoFullName);
      for (const r of rows) {
        const l = links.get(r.slug);
        if (l) r.links = l;
      }
      const board =
        action === 'available'
          ? rows.filter((r) => !r.claim || r.claim.state === 'open' || r.claim.state === 'abandoned' || r.stale)
          : rows;
      const page = applyBoardQuery(board, q);
      // The warning rides on the response an agent already reads, in the same
      // words the page uses. An agent deciding what to pick up needs to know
      // that this list is six hours behind main before it acts on it, not
      // after a human notices the board looks wrong.
      return json({
        repo: repoFullName,
        registry: meta,
        warning: registryWarning(meta),
        order: q.order ?? 'updated',
        // `count` is this page; `total` is what the filters matched. Reporting
        // only one of them is how a paged caller comes to believe a 50-row page
        // is the whole board.
        count: page.items.length,
        total: page.total,
        next_cursor: page.next_cursor,
        items: page.items,
      });
    }
    if (action === 'item') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!isSlug(slug)) return json({ error: 'slug required' }, 400);
      const claim = await readClaim(env, repoFullName, slug);
      const notes = await readNotes(env, repoFullName, slug);
      const links = await readLinks(env, repoFullName, slug);
      return json({
        repo: repoFullName, slug, registry: meta, warning: registryWarning(meta),
        claim, stale: isStale(claim), owner: claim?.owner ?? null, links, notes,
      });
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
    // Kept as a route so an old client gets a sentence instead of a 404 that
    // reads like an outage. There is nothing for the relay to refresh: the
    // registry arrives by push, and pulling is the operator's side of it.
    return json(
      {
        error: 'the registry is pushed, not pulled',
        detail:
          'This board reads the roadmap mirror the daemon pushes to the relay. The relay ' +
          'cannot refresh it on its own, and no longer reads the committed snapshot from ' +
          'GitHub to try.',
        operator_step: 'run `pd roadmap push` on the machine with the daemon',
        repo: repoFullName,
      },
      410,
    );
  }

  const slug = String(body.slug ?? '');
  if (!isSlug(slug)) return json({ error: 'slug must be a registry-shaped slug' }, 400);
  const agent = String(body.agent ?? agentDefault).slice(0, 120) || agentDefault;
  const text = String(body.body ?? body.note ?? '').slice(0, 4000);

  switch (action) {
    case 'claim': {
      const registered = await isRegistered(env, userId, repoFullName, slug);
      const kindRaw = String(body.agent_kind ?? 'session');
      const outcome = await claimSlug(env, repoFullName, slug, agent, {
        agentKind: AGENT_KINDS.includes(kindRaw as AgentKind) ? (kindRaw as AgentKind) : 'session',
        headline: String(body.headline ?? '').slice(0, 300),
        branch: body.branch === undefined ? null : String(body.branch).slice(0, 300),
        prNumber: typeof body.pr_number === 'number' ? body.pr_number : null,
        owner: body.owner === undefined ? null : String(body.owner).slice(0, 200),
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
    case 'link': {
      // Deliberately not restricted to the holder. Anyone on the board may say
      // "the ADR that decided this is here" -- a reviewer, the operator, an
      // agent that read it in passing -- and a link is additive evidence, not
      // a change to who holds the work. The claim's own fields stay holder-only.
      const kind = body.kind;
      if (!isLinkKind(kind)) {
        return json({ error: `kind must be one of ${LINK_KINDS.join(', ')}` }, 400);
      }
      const ref = String(body.ref ?? '').slice(0, 500);
      if (!ref) return json({ error: 'ref required: a PR number, a path, or a URL' }, 400);
      await addLink(env, repoFullName, slug, kind, ref, String(body.title ?? '').slice(0, 300), agent);
      return json({ slug, links: await readLinks(env, repoFullName, slug) });
    }
    case 'heartbeat': {
      const row = await heartbeat(env, repoFullName, slug, agent);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'state': {
      const state = String(body.state ?? '');
      if (!CLAIM_STATES.includes(state as ClaimState)) return json({ error: 'unknown state' }, 400);
      const row = await setState(env, repoFullName, slug, agent, state as ClaimState, text);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'note': {
      if (!text) return json({ error: 'a note needs a body' }, 400);
      await note(env, repoFullName, slug, agent, text);
      return json({ slug, ok: true });
    }
    case 'release': {
      const row = await releaseSlug(env, repoFullName, slug, agent, text);
      return row ? json({ slug, claim: row }) : json({ error: 'you do not hold that slug' }, 409);
    }
    case 'finish': {
      const pr = typeof body.pr_number === 'number' ? body.pr_number : null;
      const row = await finishSlug(env, repoFullName, slug, agent, text, pr);
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
/* An age the reader must not skim past: the amber rail is the same signal the
   board uses for a proposed slug, meaning "this is second-class, read it before
   you act on it". */
.warn{border-left:4px solid var(--amber);background:var(--surface-raised);padding:12px 18px;margin:16px 0;
      max-width:78ch;color:var(--text-primary)}
td.pri{color:var(--text-muted);text-align:right;width:3ch}
.owner{font-size:11px;color:var(--text-muted)}
.links{white-space:nowrap}
.lk{display:inline-block;font-family:"IBM Plex Mono",monospace;font-size:11px;padding:1px 6px;
    border:1px solid var(--hair);color:var(--text-secondary)}
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

  // Reaching the page with live read access is what opens the board for this
  // account's agents. Recorded here as well as in the JSON path's authorize()
  // because the browser is the only surface that can do it: an agent's device
  // token has no GitHub credential to check, so it can never be the first
  // through the door.
  await recordMembership(env, repoFullName, session.user.id);

  const meta = dateRegistryMeta(await readRegistryMeta(env, session.user.id, repoFullName));
  const rows = await readBoard(env, session.user.id, repoFullName);
  const links = await readAllLinks(env, repoFullName);
  for (const r of rows) {
    const l = links.get(r.slug);
    if (l) r.links = l;
  }
  // Held work first, then by the registry's own priority. The priority arrived
  // in the cache from the projection and was being thrown away, so the board
  // ordered a 318-slug repository alphabetically and told a reader nothing
  // about what mattered.
  rows.sort((a, b) => {
    const rank = (r: BoardRow) => (r.claim && r.claim.state !== 'open' && r.claim.state !== 'done' ? 0 : r.claim?.state === 'done' ? 2 : 1);
    const pri = (r: BoardRow) => r.priority ?? Number.POSITIVE_INFINITY;
    return rank(a) - rank(b) || pri(a) - pri(b) || a.slug.localeCompare(b.slug);
  });

  const body = rows
    .map((r) => {
      const c = r.claim;
      const state = c?.state ?? 'open';
      const prov = c?.provenance === 'proposed';
      const link = (l: WorkLink) =>
        l.kind === 'pr' || l.kind === 'issue'
          ? `<span class="lk">${esc(l.kind)}&nbsp;#${esc(l.ref)}</span>`
          : `<span class="lk" title="${esc(l.title || l.ref)}">${esc(l.kind)}</span>`;
      return `<tr>
        <td class="slug${prov ? ' prop' : ''}">${esc(r.slug)}</td>
        <td class="mono pri">${r.priority ?? ''}</td>
        <td><span class="pill s-${esc(state)}">${esc(state)}</span>${r.stale ? ' <span class="stale">stale</span>' : ''}</td>
        <td>${esc(c?.agent ?? '')}${c?.owner && c.owner !== c.agent ? `<div class="owner">for ${esc(c.owner)}</div>` : ''}</td>
        <td>${esc(c?.headline || r.summary || '')}</td>
        <td class="mono">${c?.pr_number ? `#${c.pr_number}` : ''}</td>
        <td class="mono">${esc(ago(c?.heartbeat_at ?? c?.claimed_at ?? null))}</td>
        <td class="links">${(r.links ?? []).map(link).join(' ')}</td>
      </tr>`;
    })
    .join('');

  const held = rows.filter((r) => r.claim && r.claim.state === 'held').length;
  const proposed = rows.filter((r) => r.claim?.provenance === 'proposed').length;
  // The same sentence the JSON returns, from the same function, so the page
  // and an agent reading /available never disagree about whether this list can
  // be trusted.
  const warning = registryWarning(meta);

  return shell(
    'Harbor Work Register',
    `<header class="h">
      <h1>The Harbor Work Register</h1>
      <p class="lede">Who is on what, in <code>${esc(repoFullName)}</code>, right now. The registry says what work
      exists; this board says who holds it. A claim refused is the coordination working.</p>
      <p class="meta">${rows.length} slug(s) · ${held} held · ${proposed} proposed ·
      roadmap made by the daemon ${meta ? `${esc(meta.age)} (${meta.item_count} rows in <code>${esc(meta.harbor)}</code>${meta.daemon_label ? `, from ${esc(meta.daemon_label)}` : ''}${meta.transit_seconds > 60 ? `, pushed here ${Math.round(meta.transit_seconds / 60)} min after that` : ''})` : 'never — nothing has been pushed'}</p>
    </header>
    ${warning ? `<div class="warn">${esc(warning)}</div>` : ''}
    <div class="note"><b>This board is cooperative.</b> It refuses a second claim on a held slug and tells you who
    holds it; it cannot stop an agent that never asks. The enforcement point is each agent's own harness, and the
    contract it reads is in <code>AGENTS.md</code>. A slug marked <b>proposed</b> has no row in the registry
    projection — it is queued, not scheduled, and draining that queue is the first thing to do when the roadmap
    authority comes back.</div>
    <div class="wrap"><table>
      <tr><th>Slug</th><th>Pri</th><th>State</th><th>Agent / owner</th><th>What</th><th>PR</th><th>Last heard</th><th>Links</th></tr>
      ${body || '<tr><td colspan="8">Nothing on the board yet.</td></tr>'}
    </table></div>`,
  );
}
