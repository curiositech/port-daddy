/**
 * apps/relay/src/seamanship.ts — the Seamanship data plane (G′3 account
 * surface + G′7 public listing).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE OPERATOR'S RULING, VERBATIM — this module exists to enforce it
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   "Skills need to be particular to a person and a repo for now. We do not
 *    distribute these 300 skills, they're Erich Owens' and they are particular
 *    to his repos."
 *
 * Everything below follows from that sentence:
 *
 * 1. PRIVATE BY DEFAULT. A SKILL.md with no `visibility:` is private, and so is
 *    one with a typo'd, non-string, or unrecognized value. Absence is privacy;
 *    a parser never infers a wider tier. See `parseVisibility`.
 *
 * 2. PUBLIC LISTING IS PER-SKILL OPT-IN. The opt-in is a line the author wrote
 *    into their own SKILL.md — not a checkbox on this page, not a migration, not
 *    a default anyone lands in. Two tiers, two payloads:
 *      · `listed` → names + descriptions ONLY (a directory row).
 *      · `public` → the full SKILL.md body, and only to a signed-in
 *        portdaddy.dev account.
 *
 * 3. ONE GATE. `isPublishableSkill` — imported from
 *    `lib/shipwright/skill-visibility.ts`, the same function object the Node
 *    catalog loader calls — is the ONLY thing in this codebase allowed to
 *    decide that question. Nothing here compares `entry.visibility` directly to
 *    authorize an exposure, and nothing here re-implements the predicate. If
 *    you are adding a new way for a skill to leave this operator's repos, it
 *    calls `isPublishableSkill` or it does not ship.
 *
 * ── DATA PLANE ──────────────────────────────────────────────────────────────
 *
 * The repo is the source of truth, permanently. This Worker never mirrors the
 * corpus:
 *
 *   · SKILL.md files are read on demand from the operator's OWN repos through
 *     their GitHub App installation (`fetchRepoFile`), at the repo's default
 *     branch — the trusted ref, never a PR head.
 *   · D1 holds exactly two things, and neither is the corpus:
 *       `seamanship_skill_cache`  — a SHORT-TTL (5 min) cache of parsed
 *          FRONTMATTER only (name/description/category/tags/owner/repos/
 *          visibility/pairs-with), per user, so a page view is not 40 GitHub
 *          round-trips. Bodies are never written to it.
 *       `skill_listings`          — the listed-tier projection: the operator's
 *          published name+description rows. That IS the listed payload and
 *          nothing more; the body column does not exist, by design.
 *   · Full bodies are streamed straight from GitHub per request and are NEVER
 *     persisted. Serving one re-fetches the live SKILL.md and re-runs
 *     `isPublishableSkill(entry, 'public')` against the LIVE frontmatter — so
 *     deleting `visibility: public` from a SKILL.md revokes the body on the very
 *     next request, with no cache to invalidate and no sweep to wait for.
 *
 * ── NAMESPACE ───────────────────────────────────────────────────────────────
 *
 * Public ids are `@<github-login>/<skill-id>` (`@erichowens/skill-architect`).
 * The catalog is one person's today; the namespace is what makes that true on
 * the wire rather than merely true in practice, and is what a second operator
 * would slot into without a migration.
 */

import { parse as parseYaml } from 'yaml';
import type { Env } from './types.js';
import {
  isPublishableSkill,
  parseVisibility,
  type SkillVisibility,
} from '../../../lib/shipwright/skill-visibility.js';
import { extractPairsWithTargets } from '../../../lib/skill-pairs-with.js';
import {
  resolveSession,
  isSameOrigin,
  listUserInstallations,
  type ResolvedSession,
} from './auth-github.js';
import { fetchRepoFile, getRepoToken } from './github-app.js';

// Re-exported so a reader of any Seamanship surface can see, in one import,
// that the gate is the shared predicate and not a local look-alike.
export { isPublishableSkill };
export type { SkillVisibility };

const GH_API = 'https://api.github.com';

/** Directory, relative to a repo root, that holds `<id>/SKILL.md` entries. */
export const SKILLS_DIR = 'skills';

/** How long a parsed-frontmatter cache row stays fresh. Deliberately short:
 *  the repo is the truth and an opt-in must take effect in minutes, not days. */
export const SKILL_CACHE_TTL_SECONDS = 300;

/** Distinct repos scanned per account-page view. Beyond this the page says so. */
export const MAX_REPOS_SCANNED = 6;

/** SKILL.md frontmatter reads per view, across all repos. Bounds the fan-out
 *  of one page load into GitHub; the page announces truncation honestly. */
export const MAX_SKILL_READS = 40;

/** Rows served by the public listing in one response. */
export const PUBLIC_LISTING_LIMIT = 200;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'port-daddy-relay',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  SKILL.md parsing (frontmatter + body)
// ══════════════════════════════════════════════════════════════════════════

/** One skill as the relay knows it: frontmatter facts plus where it lives. */
export interface RelaySkillEntry {
  /** Stable id — frontmatter `name`. */
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** Frontmatter `owner`. `undefined` is "no attribution recorded", never "unowned". */
  owner?: string;
  /** Frontmatter `repos` — the repos the AUTHOR scoped this skill to. */
  declaredRepos: string[];
  /**
   * The parsed tier. Read it for DISPLAY. Never compare it to authorize an
   * exposure — call `isPublishableSkill` (this module's re-export).
   */
  visibility: SkillVisibility;
  /** Curated `pairs-with` targets. NOT the full first-hop graph — see below. */
  pairsWith: string[];
  /** `owner/name` of the repo the file was actually read from. */
  repoFullName: string;
  /** Path within that repo, e.g. `skills/skill-architect/SKILL.md`. */
  sourcePath: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a SKILL.md into its YAML frontmatter object and its prose body. */
export function splitSkillMarkdown(
  text: string,
): { frontmatter: Record<string, unknown>; body: string } | null {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const rawYaml = m[1] ?? '';
  const body = m[2] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { frontmatter: parsed as Record<string, unknown>, body };
}

function strArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

/**
 * Parse one SKILL.md into a `RelaySkillEntry`. Returns `null` when the file has
 * no frontmatter or is missing `name`/`description` — a malformed skill is
 * SKIPPED, never surfaced with guessed fields, and never poisons the scan.
 *
 * Mirrors the Node loader's field reading (`loadSkillCatalog`) exactly, and
 * routes `visibility` through the shared `parseVisibility` so a typo resolves
 * to `'private'` here for the same reason it does there.
 */
export function parseSkillEntry(
  text: string,
  repoFullName: string,
  sourcePath: string,
  onWarning?: (msg: string) => void,
): RelaySkillEntry | null {
  const split = splitSkillMarkdown(text);
  if (!split) {
    onWarning?.(`${repoFullName}:${sourcePath}: no parseable YAML frontmatter, skipped`);
    return null;
  }
  const fm = split.frontmatter;
  const name = typeof fm.name === 'string' ? fm.name.trim() : '';
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  if (!name || !description) {
    onWarning?.(`${repoFullName}:${sourcePath}: frontmatter missing name or description, skipped`);
    return null;
  }
  const metadata =
    fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)
      ? (fm.metadata as Record<string, unknown>)
      : {};
  const owner =
    typeof fm.owner === 'string' && fm.owner.trim() ? fm.owner.trim() : undefined;
  const entry: RelaySkillEntry = {
    id: name,
    name,
    description,
    category: typeof metadata.category === 'string' ? metadata.category : '',
    tags: strArray(metadata.tags),
    declaredRepos: strArray(fm.repos),
    visibility: parseVisibility(fm.visibility, `${repoFullName}:${sourcePath}`, onWarning),
    pairsWith: extractPairsWithTargets(fm, name),
    repoFullName,
    sourcePath,
  };
  if (owner !== undefined) entry.owner = owner;
  return entry;
}

// ══════════════════════════════════════════════════════════════════════════
//  Namespacing — @<login>/<id>
// ══════════════════════════════════════════════════════════════════════════

/** GitHub logins; also the shape a namespace segment must match. */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Skill ids are directory-safe slugs. Anything else never becomes a public id. */
const SKILL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `octocat` + `skill-architect` → `@octocat/skill-architect`. */
export function qualifySkillId(login: string, id: string): string {
  return `@${login}/${id}`;
}

/**
 * Parse `@login/skill-id` back into its parts, or `null` when it is not a
 * well-formed qualified id. Strict on purpose: a public route's path segment is
 * attacker-controlled, and a loose parse here becomes a D1 wildcard downstream.
 */
export function parseQualifiedSkillId(
  raw: string,
): { login: string; id: string } | null {
  if (!raw.startsWith('@')) return null;
  const slash = raw.indexOf('/');
  if (slash < 2) return null;
  const login = raw.slice(1, slash);
  const id = raw.slice(slash + 1);
  if (!LOGIN_RE.test(login) || !SKILL_ID_RE.test(id)) return null;
  return { login, id };
}

// ══════════════════════════════════════════════════════════════════════════
//  The catalog scan — the operator's own repos, through their installation
// ══════════════════════════════════════════════════════════════════════════

/** One repo the scan looked at, and what it found there. */
export interface ScannedRepo {
  repoFullName: string;
  /** The trusted ref read (the repo's default branch). */
  ref: string;
  skills: RelaySkillEntry[];
  /** True when this repo has no `skills/` directory at all — not an error. */
  noSkillsDir: boolean;
}

export interface CatalogScan {
  repos: ScannedRepo[];
  /** More repos existed than `MAX_REPOS_SCANNED`; the view is partial. */
  reposTruncated: boolean;
  /** The SKILL.md read budget ran out; some skills are not shown. */
  skillsTruncated: boolean;
  /**
   * `null` when the installation list could not be established (no token,
   * GitHub error). Reads degrade with a reason — never a fabricated empty
   * catalog that reads as "you have no skills".
   */
  installationsKnown: boolean;
  warnings: string[];
}

interface RepoRef {
  fullName: string;
  defaultBranch: string;
}

/**
 * The repos reachable through the signed-in user's OWN GitHub App
 * installations. GitHub is the tenancy authority: `GET /user/installations`
 * lists the installations this user may act on, and
 * `/user/installations/:id/repositories` lists what they can reach inside one.
 * A repo that does not come back from that pair is never scanned.
 */
async function listInstallationRepos(
  env: Env,
  session: ResolvedSession,
  limit: number,
): Promise<{ repos: RepoRef[]; truncated: boolean } | null> {
  const installations = await listUserInstallations(env, session);
  if (installations === null || !session.ghToken) return null;
  const seen = new Set<string>();
  const repos: RepoRef[] = [];
  let truncated = false;
  for (const inst of installations) {
    if (repos.length >= limit) {
      truncated = true;
      break;
    }
    const res = await fetch(
      `${GH_API}/user/installations/${inst.id}/repositories?per_page=100`,
      { headers: ghHeaders(session.ghToken) },
    );
    if (!res.ok) continue;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      continue;
    }
    const list =
      body && typeof body === 'object' && Array.isArray((body as { repositories?: unknown }).repositories)
        ? ((body as { repositories: unknown[] }).repositories)
        : [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as { full_name?: unknown; default_branch?: unknown };
      const fullName = typeof r.full_name === 'string' ? r.full_name : '';
      if (!REPO_FULL_NAME_RE.test(fullName) || seen.has(fullName)) continue;
      if (repos.length >= limit) {
        truncated = true;
        break;
      }
      seen.add(fullName);
      repos.push({
        fullName,
        defaultBranch: typeof r.default_branch === 'string' && r.default_branch ? r.default_branch : 'main',
      });
    }
  }
  return { repos, truncated };
}

/** The skill directory names under `skills/` at a trusted ref, or `null` when
 *  the repo has no such directory. Same shape as `listShipFiles`, one call. */
async function listSkillDirs(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<string[] | null> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${SKILLS_DIR}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body)) return null;
  const out: string[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as { name?: unknown; type?: unknown };
    if (e.type !== 'dir' || typeof e.name !== 'string') continue;
    if (!SKILL_ID_RE.test(e.name)) continue;
    out.push(e.name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

// ── D1: the short-TTL frontmatter cache (never bodies) ───────────────────────

interface CacheRow {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  tags_json: string;
  owner: string | null;
  repos_json: string;
  visibility: string;
  pairs_with_json: string;
  fetched_at: number;
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToEntry(row: CacheRow, repoFullName: string, sourcePath: string): RelaySkillEntry {
  const entry: RelaySkillEntry = {
    id: row.skill_id,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: parseJsonArray(row.tags_json),
    declaredRepos: parseJsonArray(row.repos_json),
    // Re-parsed rather than trusted: a cache row is still input, and the tier
    // it resolves to must come from the ONE parser, never from a raw column.
    visibility: parseVisibility(row.visibility, `${repoFullName}:${sourcePath}`),
    pairsWith: parseJsonArray(row.pairs_with_json),
    repoFullName,
    sourcePath,
  };
  if (row.owner) entry.owner = row.owner;
  return entry;
}

async function readCachedSkills(
  env: Env,
  userId: string,
  repoFullName: string,
  nowSec: number,
): Promise<Map<string, RelaySkillEntry>> {
  const out = new Map<string, RelaySkillEntry>();
  try {
    const res = await env.DB.prepare(
      `SELECT source_path, skill_id, name, description, category, tags_json, owner,
              repos_json, visibility, pairs_with_json, fetched_at
         FROM seamanship_skill_cache
        WHERE user_id = ? AND repo_full_name = ? AND fetched_at > ?`,
    )
      .bind(userId, repoFullName, nowSec - SKILL_CACHE_TTL_SECONDS)
      .all<CacheRow & { source_path: string }>();
    for (const row of res.results ?? []) {
      out.set(row.source_path, rowToEntry(row, repoFullName, row.source_path));
    }
  } catch {
    // A cache miss is always safe: the scan just pays the GitHub round-trip.
  }
  return out;
}

async function writeCachedSkill(
  env: Env,
  userId: string,
  entry: RelaySkillEntry,
  nowSec: number,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO seamanship_skill_cache
         (user_id, repo_full_name, source_path, skill_id, name, description, category,
          tags_json, owner, repos_json, visibility, pairs_with_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, repo_full_name, source_path) DO UPDATE SET
         skill_id = excluded.skill_id, name = excluded.name,
         description = excluded.description, category = excluded.category,
         tags_json = excluded.tags_json, owner = excluded.owner,
         repos_json = excluded.repos_json, visibility = excluded.visibility,
         pairs_with_json = excluded.pairs_with_json, fetched_at = excluded.fetched_at`,
    )
      .bind(
        userId,
        entry.repoFullName,
        entry.sourcePath,
        entry.id,
        entry.name,
        entry.description,
        entry.category,
        JSON.stringify(entry.tags),
        entry.owner ?? null,
        JSON.stringify(entry.declaredRepos),
        entry.visibility,
        JSON.stringify(entry.pairsWith),
        nowSec,
      )
      .run();
  } catch {
    // Caching is an optimization. A write failure must never sink a page view.
  }
}

/**
 * Scan the operator's own repos for `skills/<id>/SKILL.md`, newest-first by
 * nothing at all — alphabetical, because a stable order is what makes the
 * read budget's truncation reproducible instead of arbitrary.
 *
 * Every read is at the repo's DEFAULT BRANCH (the trusted ref), through the
 * GitHub App installation token, exactly as the fleet control plane reads
 * `pd-fleet.yml`. Frontmatter is cached in D1 for `SKILL_CACHE_TTL_SECONDS`;
 * bodies are not read here at all.
 */
export async function scanOperatorCatalog(
  env: Env,
  session: ResolvedSession,
  opts: { maxRepos?: number; maxSkillReads?: number; nowSec?: number } = {},
): Promise<CatalogScan> {
  const maxRepos = opts.maxRepos ?? MAX_REPOS_SCANNED;
  const maxReads = opts.maxSkillReads ?? MAX_SKILL_READS;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const warnings: string[] = [];
  const scan: CatalogScan = {
    repos: [],
    reposTruncated: false,
    skillsTruncated: false,
    installationsKnown: false,
    warnings,
  };

  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    warnings.push('GitHub App is not configured on this relay; no repo can be read.');
    return scan;
  }
  const listed = await listInstallationRepos(env, session, maxRepos);
  if (listed === null) return scan; // installationsKnown stays false — honest "unknown"
  scan.installationsKnown = true;
  scan.reposTruncated = listed.truncated;

  let readsLeft = maxReads;
  for (const repo of listed.repos) {
    const [owner, name] = repo.fullName.split('/');
    if (!owner || !name) continue;
    let token: string;
    try {
      token = await getRepoToken(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        owner,
        name,
        env.KV,
      );
    } catch {
      warnings.push(`${repo.fullName}: installation token unavailable; repo skipped.`);
      continue;
    }
    const dirs = await listSkillDirs(owner, name, repo.defaultBranch, token);
    if (dirs === null) {
      scan.repos.push({ repoFullName: repo.fullName, ref: repo.defaultBranch, skills: [], noSkillsDir: true });
      continue;
    }
    const cached = await readCachedSkills(env, session.user.id, repo.fullName, nowSec);
    const skills: RelaySkillEntry[] = [];
    for (const dir of dirs) {
      const sourcePath = `${SKILLS_DIR}/${dir}/SKILL.md`;
      const hit = cached.get(sourcePath);
      if (hit) {
        skills.push(hit);
        continue;
      }
      if (readsLeft <= 0) {
        scan.skillsTruncated = true;
        break;
      }
      readsLeft -= 1;
      const text = await fetchRepoFile(owner, name, sourcePath, repo.defaultBranch, token);
      if (text === null) continue;
      const entry = parseSkillEntry(text, repo.fullName, sourcePath, (w) => warnings.push(w));
      if (!entry) continue;
      skills.push(entry);
      await writeCachedSkill(env, session.user.id, entry, nowSec);
    }
    scan.repos.push({
      repoFullName: repo.fullName,
      ref: repo.defaultBranch,
      skills,
      noSkillsDir: false,
    });
  }
  return scan;
}

/** Every skill in a scan, flattened. */
export function allSkills(scan: CatalogScan): RelaySkillEntry[] {
  return scan.repos.flatMap((r) => r.skills);
}

/**
 * Resolve one skill's curated `pairs-with` neighbours against the ids actually
 * present in the scan.
 *
 * SCOPE, stated honestly because the page states it too: this is the CURATED
 * half of the first-hop graph — the edges an author wrote down. The graft
 * index's other signal, a skill id mentioned as a whole word in another
 * skill's prose, needs the prose bodies, which this surface deliberately does
 * not hold. A neighbour whose id is not in the scan is returned as `known:
 * false` rather than dropped: "declared but not in the repos we read" is a
 * different fact from "not declared", and a catalog view should not launder
 * one into the other.
 */
export interface PairsWithNeighbour {
  id: string;
  known: boolean;
}

export function resolvePairsWith(
  entry: RelaySkillEntry,
  scan: CatalogScan,
): PairsWithNeighbour[] {
  const present = new Set(allSkills(scan).map((s) => s.id));
  const seen = new Set<string>();
  const out: PairsWithNeighbour[] = [];
  for (const id of entry.pairsWith) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, known: present.has(id) });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
//  G′7 — the public listing projection
// ══════════════════════════════════════════════════════════════════════════

/**
 * ONE listed-tier row. This interface is deliberately three fields wide: the
 * listed tier authorizes a name and a description, so a listed row IS a name
 * and a description. There is no `body`, no `tags`, no `repo` — a field that
 * does not exist cannot leak, and a reviewer can confirm the tier boundary by
 * reading this type rather than by auditing every call site.
 */
export interface ListedSkill {
  /** `@login/id` */
  qualifiedId: string;
  name: string;
  description: string;
}

export interface ListingRow {
  namespace: string;
  skill_id: string;
  name: string;
  description: string;
  repo_full_name: string;
  source_path: string;
  updated_at: number;
}

/**
 * The listed-tier projection of a scan: every entry the ONE gate authorizes at
 * `tier: 'listed'`, and nothing else. This is the only function that turns
 * catalog entries into published rows.
 */
export function listedProjection(
  entries: readonly RelaySkillEntry[],
  login: string,
): Array<{ entry: RelaySkillEntry; listed: ListedSkill }> {
  const out: Array<{ entry: RelaySkillEntry; listed: ListedSkill }> = [];
  for (const entry of entries) {
    if (!isPublishableSkill(entry, 'listed')) continue;
    out.push({
      entry,
      listed: {
        qualifiedId: qualifySkillId(login, entry.id),
        name: entry.name,
        description: entry.description,
      },
    });
  }
  return out;
}

/** What a listing sync did. `ok: false` carries the reason and changed nothing. */
export type PublishOutcome =
  | { ok: true; namespace: string; listed: number; scanned: number }
  | { ok: false; code: 'BAD_NAMESPACE' | 'CATALOG_UNAVAILABLE'; error: string };

/**
 * Re-scan the operator's repos and make the public listing agree with what
 * their SKILL.md files currently say.
 *
 * This is a SYNC, not a grant: the opt-in already happened in the repo. Rows
 * are inserted for skills that pass `isPublishableSkill(entry, 'listed')` and
 * DELETED for everything else in this namespace — so removing `visibility:`
 * from a SKILL.md and re-syncing un-publishes it. Delete runs BEFORE insert, so
 * a crash between the two leaves the catalog narrower, never wider.
 *
 * A scan that could not read the repos publishes and un-publishes NOTHING: a
 * GitHub outage must not be able to silently empty a directory, and it must not
 * be able to leave a withdrawn skill listed either. Refusing is the only answer
 * that is wrong in neither direction.
 */
export async function syncSkillListings(
  env: Env,
  session: ResolvedSession,
): Promise<PublishOutcome> {
  const login = session.user.login;
  if (!LOGIN_RE.test(login)) {
    return { ok: false, code: 'BAD_NAMESPACE', error: 'account login is not a usable namespace' };
  }
  const scan = await scanOperatorCatalog(env, session);
  if (!scan.installationsKnown) {
    return {
      ok: false,
      code: 'CATALOG_UNAVAILABLE',
      error: 'your repositories could not be read right now; nothing was published or unpublished',
    };
  }
  const scanned = allSkills(scan);
  const published = listedProjection(scanned, login);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM skill_listings WHERE namespace = ?').bind(login).run();
  for (const { entry, listed } of published) {
    await env.DB.prepare(
      `INSERT INTO skill_listings
         (namespace, skill_id, name, description, repo_full_name, source_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (namespace, skill_id) DO UPDATE SET
         name = excluded.name, description = excluded.description,
         repo_full_name = excluded.repo_full_name, source_path = excluded.source_path,
         updated_at = excluded.updated_at`,
    )
      .bind(login, entry.id, listed.name, listed.description, entry.repoFullName, entry.sourcePath, now)
      .run();
  }
  return { ok: true, namespace: `@${login}`, listed: published.length, scanned: scanned.length };
}

/** POST /v1/seamanship/publish — the JSON form of {@link syncSkillListings}. */
export async function handleSeamanshipPublish(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHORIZED', error: 'sign in required' });
  if (!isSameOrigin(request, env)) {
    return json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
  }
  const outcome = await syncSkillListings(env, session);
  if (!outcome.ok) {
    return json(outcome.code === 'BAD_NAMESPACE' ? 400 : 503, {
      code: outcome.code,
      error: outcome.error,
    });
  }
  return json(200, {
    code: 'OK',
    error: null,
    namespace: outcome.namespace,
    listed: outcome.listed,
    scanned: outcome.scanned,
  });
}

/**
 * GET /v1/skills — the PUBLIC directory. No session, no secrets, and by
 * construction no payload beyond the listed tier: the response is built from
 * `skill_listings`, whose columns are the listed payload plus the coordinates
 * needed to fetch a body later. The repo coordinates are NEVER serialized —
 * "particular to his repos" means the repo names are not the public's business
 * either.
 */
export async function handlePublicSkillsListing(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const nsParam = url.searchParams.get('namespace');
  let rows: ListingRow[] = [];
  try {
    if (nsParam) {
      const login = nsParam.startsWith('@') ? nsParam.slice(1) : nsParam;
      if (!LOGIN_RE.test(login)) return json(400, { code: 'BAD_NAMESPACE', error: 'invalid namespace' });
      const res = await env.DB.prepare(
        `SELECT namespace, skill_id, name, description, repo_full_name, source_path, updated_at
           FROM skill_listings WHERE namespace = ? ORDER BY skill_id ASC LIMIT ?`,
      )
        .bind(login, PUBLIC_LISTING_LIMIT)
        .all<ListingRow>();
      rows = res.results ?? [];
    } else {
      const res = await env.DB.prepare(
        `SELECT namespace, skill_id, name, description, repo_full_name, source_path, updated_at
           FROM skill_listings ORDER BY namespace ASC, skill_id ASC LIMIT ?`,
      )
        .bind(PUBLIC_LISTING_LIMIT)
        .all<ListingRow>();
      rows = res.results ?? [];
    }
  } catch {
    return json(500, { code: 'INTERNAL_ERROR', error: 'listing unavailable' });
  }
  const skills: ListedSkill[] = rows.map((r) => ({
    qualifiedId: qualifySkillId(r.namespace, r.skill_id),
    name: r.name,
    description: r.description,
  }));
  return new Response(
    JSON.stringify({ code: 'OK', error: null, tier: 'listed', skills, count: skills.length }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // A public directory may be cached briefly; it holds only what its
        // authors opted into publishing.
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}

/** What a body request resolved to. Never carries a body it did not authorize. */
export type SkillBodyOutcome =
  | { kind: 'not-found' }
  | { kind: 'auth-required'; qualifiedId: string; name: string; description: string }
  | { kind: 'ok'; qualifiedId: string; entry: RelaySkillEntry; body: string };

/**
 * Resolve `@login/id` to a full SKILL.md body, or to the honest reason it is
 * not being served.
 *
 * The order of the checks is the whole security argument:
 *
 *   1. The row must exist in the listed projection. A skill that was never
 *      listed is `not-found` — the SAME `not-found` a nonexistent id gets, so
 *      the endpoint is not an existence oracle for a private catalog.
 *   2. A session is required. Unauthenticated callers get `auth-required`
 *      carrying ONLY the listed payload they were already entitled to.
 *   3. The live SKILL.md is re-fetched from the repo and re-parsed, and
 *      `isPublishableSkill(entry, 'public')` is run against THAT frontmatter —
 *      not against the stored row. The projection can be stale; the repo cannot.
 *      A skill that dropped from `public` back to `listed` stops serving its
 *      body on the next request.
 */
export async function resolveSkillBody(
  env: Env,
  session: ResolvedSession | null,
  qualifiedId: string,
): Promise<SkillBodyOutcome> {
  const parsed = parseQualifiedSkillId(qualifiedId);
  if (!parsed) return { kind: 'not-found' };
  let row: ListingRow | null = null;
  try {
    row = await env.DB.prepare(
      `SELECT namespace, skill_id, name, description, repo_full_name, source_path, updated_at
         FROM skill_listings WHERE namespace = ? AND skill_id = ?`,
    )
      .bind(parsed.login, parsed.id)
      .first<ListingRow>();
  } catch {
    return { kind: 'not-found' };
  }
  if (!row) return { kind: 'not-found' };
  if (!session) {
    return {
      kind: 'auth-required',
      qualifiedId: qualifySkillId(row.namespace, row.skill_id),
      name: row.name,
      description: row.description,
    };
  }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return { kind: 'not-found' };
  if (!REPO_FULL_NAME_RE.test(row.repo_full_name)) return { kind: 'not-found' };
  const [owner, repo] = row.repo_full_name.split('/');
  if (!owner || !repo) return { kind: 'not-found' };
  let token: string;
  try {
    token = await getRepoToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, owner, repo, env.KV);
  } catch {
    return { kind: 'not-found' };
  }
  let ref: string;
  try {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) });
    if (!res.ok) return { kind: 'not-found' };
    const body = (await res.json()) as { default_branch?: string };
    ref = typeof body.default_branch === 'string' && body.default_branch ? body.default_branch : 'main';
  } catch {
    return { kind: 'not-found' };
  }
  const text = await fetchRepoFile(owner, repo, row.source_path, ref, token);
  if (text === null) return { kind: 'not-found' };
  const entry = parseSkillEntry(text, row.repo_full_name, row.source_path);
  if (!entry) return { kind: 'not-found' };
  // THE GATE. Live frontmatter, one predicate, public tier.
  if (!isPublishableSkill(entry, 'public')) {
    // Still listed (the row exists), just not public: hand back the listed
    // payload, never the body, and never a different 404 that would reveal
    // which of the two it was.
    return {
      kind: 'auth-required',
      qualifiedId: qualifySkillId(row.namespace, row.skill_id),
      name: entry.name,
      description: entry.description,
    };
  }
  const split = splitSkillMarkdown(text);
  return {
    kind: 'ok',
    qualifiedId: qualifySkillId(row.namespace, row.skill_id),
    entry,
    body: split ? split.body : '',
  };
}

/** GET /v1/skills/@:login/:id — the full-body API. Session + `public` tier. */
export async function handlePublicSkillBody(
  request: Request,
  env: Env,
  qualifiedId: string,
): Promise<Response> {
  const session = await resolveSession(request, env);
  const outcome = await resolveSkillBody(env, session, qualifiedId);
  switch (outcome.kind) {
    case 'not-found':
      return json(404, { code: 'NOT_FOUND', error: 'no such published skill' });
    case 'auth-required':
      return json(403, {
        code: 'ACCOUNT_REQUIRED',
        error:
          'the full text of this skill is available to signed-in portdaddy.dev accounts, ' +
          'and only for skills their author marked visibility: public',
        skill: {
          qualifiedId: outcome.qualifiedId,
          name: outcome.name,
          description: outcome.description,
        },
      });
    case 'ok':
      return json(200, {
        code: 'OK',
        error: null,
        tier: 'public',
        skill: {
          qualifiedId: outcome.qualifiedId,
          name: outcome.entry.name,
          description: outcome.entry.description,
          category: outcome.entry.category,
          tags: outcome.entry.tags,
          body: outcome.body,
        },
      });
  }
}
