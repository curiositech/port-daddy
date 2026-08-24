/**
 * X6 deprecation machinery - RFC 9745 (Deprecation) + RFC 8594 (Sunset) with
 * teeth (docs/proposals/relay-grand-plan.md SX6; grand-plan DAG node
 * x6-deprecation-alias).
 *
 * The registry (src/deprecations.json) is the single source of truth for WHICH
 * surfaces are deprecated. It is read by three consumers:
 *   1. this module (Worker middleware): path canonicalization for the /v1/
 *      aliases, header emission on the deprecated forms, the structured 410
 *      tombstone, and cheap KV sightings;
 *   2. scripts/check-sunsets.mjs (CI): fails the build 7 days before a sunset
 *      unless the surface is tombstoned or the sunset was extended by commit;
 *   3. migrations/2026-08-09-x6-deprecations.sql: mirrors the registry into
 *      the deprecations D1 table so lifecycle questions are answerable by SQL
 *      (the middleware itself NEVER reads D1 on the hot path).
 *
 * Sightings are cheap by construction: a deprecated hit fire-and-forgets ONE
 * KV put keyed (deprecation, protocol, caller-fingerprint); the retention
 * sweep flushes KV into the deprecation_sightings D1 table, cardinality-capped
 * - there is never a hot-path D1 write. Removing a surface requires
 * surfaceRemovalAllowed (zero identities seen in REMOVAL_QUIET_DAYS) to say
 * yes - deletion policy as a query, not a vibe.
 */

import type { Env } from './types.js';
import { hashHex } from './crypto.js';
import registry from './deprecations.json';

export interface DeprecationSpec {
  /** Stable registry id, e.g. 'auth-unversioned'. */
  id: string;
  /** Deprecated path prefix (with trailing slash), e.g. '/auth/'. */
  prefix: string;
  /** Canonical successor prefix, e.g. '/v1/auth/'. */
  successorPrefix: string;
  /** Unix seconds (UTC midnight of the registry ISO day). */
  deprecatedAt: number;
  /** Unix seconds, or null when no sunset is scheduled. */
  sunsetAt: number | null;
  docsUrl: string;
  /** True once the surface answers a structured 410 instead of dispatching. */
  tombstoned: boolean;
}

interface RawRegistryEntry {
  id: string;
  prefix: string;
  successorPrefix: string;
  deprecatedAt: string;
  sunsetAt?: string | null;
  docsUrl: string;
  tombstoned?: boolean;
  note?: string;
}

function parseIsoDayUtc(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`deprecations registry: bad ISO day ${day}`);
  return Math.floor(ms / 1000);
}

function parseRegistry(entries: RawRegistryEntry[]): DeprecationSpec[] {
  return entries.map((e) => ({
    id: e.id,
    prefix: e.prefix,
    successorPrefix: e.successorPrefix,
    deprecatedAt: parseIsoDayUtc(e.deprecatedAt),
    sunsetAt: e.sunsetAt ? parseIsoDayUtc(e.sunsetAt) : null,
    docsUrl: e.docsUrl,
    tombstoned: e.tombstoned === true,
  }));
}

export const DEPRECATIONS: readonly DeprecationSpec[] = parseRegistry(
  (registry as { deprecations: RawRegistryEntry[] }).deprecations,
);

// Test seam: index.ts routes through the module-level registry, so exercising
// the tombstone path end-to-end (a tombstoned surface in the REAL registry
// would change live behavior) needs an override hook. Production code never
// calls this.
let active: readonly DeprecationSpec[] = DEPRECATIONS;
export function setDeprecationsForTesting(specs: readonly DeprecationSpec[] | null): void {
  active = specs ?? DEPRECATIONS;
}

/** The deprecation covering this request path, or null. Prefix match only:
 *  the canonical /v1/ forms never match (their prefixes are not deprecated). */
export function matchDeprecation(pathname: string): DeprecationSpec | null {
  for (const d of active) if (pathname.startsWith(d.prefix)) return d;
  return null;
}

/** PURE aliasing: /v1/auth/* and /v1/billing/* rewrite to the bare prefix the
 *  router already dispatches on - same handlers, byte-identical bodies. */
export function canonicalizeDeprecatedPath(pathname: string): string {
  for (const d of active) {
    if (pathname.startsWith(d.successorPrefix)) {
      return d.prefix + pathname.slice(d.successorPrefix.length);
    }
  }
  return pathname;
}

/** Successor URI-reference for a concrete deprecated request path. */
export function successorPath(spec: DeprecationSpec, requestPath: string): string {
  return requestPath.startsWith(spec.prefix)
    ? spec.successorPrefix + requestPath.slice(spec.prefix.length)
    : spec.successorPrefix;
}

/** RFC 9745 Deprecation + RFC 8594 Sunset + Link headers (rel
 *  successor-version points at the /v1/ twin; rel deprecation at the docs). */
export function withDeprecationHeaders(
  response: Response,
  spec: DeprecationSpec,
  requestPath: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Deprecation', `@${spec.deprecatedAt}`);
  if (spec.sunsetAt !== null) {
    headers.set('Sunset', new Date(spec.sunsetAt * 1000).toUTCString());
  }
  headers.set(
    'Link',
    `<${successorPath(spec, requestPath)}>; rel="successor-version", <${spec.docsUrl}>; rel="deprecation"`,
  );
  return new Response(response.body, { status: response.status, headers });
}

const isoDay = (unix: number | null): string | null =>
  (unix === null ? null : new Date(unix * 1000).toISOString().slice(0, 10));

/**
 * Structured 410 tombstone. The SHAPE is a contract with the client-side
 * renderer (shared/relay-tombstone.ts) and is pinned on both sides by the
 * shared golden fixture tests/fixtures/relay-tombstone-golden.json - change
 * them together or not at all.
 */
export function renderTombstone(spec: DeprecationSpec, requestPath: string): Response {
  return Response.json(
    {
      error: `${requestPath} has been sunset; use ${successorPath(spec, requestPath)}`,
      code: 'SURFACE_SUNSET',
      endpoint: requestPath,
      deprecation: {
        id: spec.id,
        deprecated_at: isoDay(spec.deprecatedAt),
        sunset_at: isoDay(spec.sunsetAt),
        successor: successorPath(spec, requestPath),
        docs: spec.docsUrl,
        min_version: null,
      },
    },
    { status: 410 },
  );
}

// -- Sightings (cheap by construction) ---------------------------------------

export const SIGHTING_KV_PREFIX = 'depsight:';
/** KV rows self-expire comfortably past the 30-day removal-quiet window. */
export const SIGHTING_KV_TTL_SECONDS = 45 * 24 * 60 * 60;
/** Hard cap on distinct (deprecation, protocol, fingerprint) rows in D1. */
export const SIGHTING_ROW_CAP = 2000;
/**
 * Identities beyond the cap fold into this synthetic fingerprint - the
 * conservative direction: the sighting still counts against removal; only the
 * per-identity attribution is dropped.
 */
export const OVERFLOW_FINGERPRINT = '__overflow__';

/** Pseudonymous caller fingerprint: hash prefix of presented credential
 *  material (bearer header, else cookie), never the credential itself. */
export function callerFingerprint(request: Request): string {
  const auth = request.headers.get('Authorization');
  if (auth) return hashHex(auth).slice(0, 16);
  const cookie = request.headers.get('Cookie');
  if (cookie) return hashHex(cookie).slice(0, 16);
  return 'anon';
}

/** Client-declared protocol (x-pd-protocol), sanitized into the key alphabet. */
export function callerProtocol(request: Request): string {
  const raw = request.headers.get('x-pd-protocol');
  if (!raw) return 'unversioned';
  return raw.slice(0, 32).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Fire-and-forget last-seen buffer write. ONE KV put, no reads, no D1 -
 * failures (including the 1 write/sec/key KV limit) are swallowed: sightings
 * are operational metadata, never worth failing a request over.
 */
export function recordDeprecationSighting(
  env: Env,
  ctx: ExecutionContext | undefined,
  spec: DeprecationSpec,
  request: Request,
  now: number,
): void {
  try {
    const kv = (env as { KV?: KVNamespace }).KV;
    if (!kv) return;
    const key = `${SIGHTING_KV_PREFIX}${spec.id}:${callerProtocol(request)}:${callerFingerprint(request)}`;
    const value = JSON.stringify({ last_seen: now, path: new URL(request.url).pathname });
    const put = kv.put(key, value, { expirationTtl: SIGHTING_KV_TTL_SECONDS }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put);
  } catch {
    /* never let telemetry break a response */
  }
}

export interface SightingFlushResult {
  listed: number;
  flushed: number;
  inserted: number;
  updated: number;
  overflowed: number;
  errors: string[];
}

type KvListPage = { keys: { name: string }[]; list_complete: boolean; cursor?: string };

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const UPDATE_SIGHTING_SQL =
  'UPDATE deprecation_sightings SET last_seen = MAX(last_seen, ?), last_path = ? ' +
  'WHERE deprecation_id = ? AND protocol = ? AND fingerprint = ?';
const INSERT_SIGHTING_SQL =
  'INSERT INTO deprecation_sightings (deprecation_id, protocol, fingerprint, last_seen, last_path) ' +
  'VALUES (?, ?, ?, ?, ?)';

/**
 * Drain buffered KV sightings into deprecation_sightings, cardinality-capped.
 * Called by the retention sweep (never the request hot path). Best-effort:
 * per-key failures are recorded and skipped; only a flushed key is deleted
 * from KV, so anything missed survives for the next sweep.
 */
export async function flushDeprecationSightings(
  env: Env,
  opts?: { cap?: number; maxKeys?: number },
): Promise<SightingFlushResult> {
  const kv = (env as { KV?: KVNamespace }).KV;
  const db = (env as { DB?: D1Database }).DB;
  const zero: SightingFlushResult = { listed: 0, flushed: 0, inserted: 0, updated: 0, overflowed: 0, errors: [] };
  if (!kv || !db) return zero;

  const cap = opts?.cap ?? SIGHTING_ROW_CAP;
  const maxKeys = opts?.maxKeys ?? 5000;
  const errors: string[] = [];
  let listed = 0;
  let flushed = 0;
  let inserted = 0;
  let updated = 0;
  let overflowed = 0;

  // The cap needs the current row count; without it the cap is unenforceable,
  // so a failed count aborts the flush (KV keys survive for the next sweep).
  let rowCount: number;
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM deprecation_sightings')
      .first<{ n: number }>();
    rowCount = row?.n ?? 0;
  } catch (e) {
    return { ...zero, errors: [`sightings count: ${msg(e)}`] };
  }

  let cursor: string | undefined;
  do {
    let page: KvListPage;
    try {
      page = (await kv.list({ prefix: SIGHTING_KV_PREFIX, cursor })) as unknown as KvListPage;
    } catch (e) {
      errors.push(`sightings kv list: ${msg(e)}`);
      break;
    }
    for (const k of page.keys) {
      if (listed >= maxKeys) break;
      listed++;
      try {
        const parts = k.name.slice(SIGHTING_KV_PREFIX.length).split(':');
        const depId = parts[0];
        const protocol = parts[1];
        const fingerprint = parts[2];
        if (parts.length !== 3 || !depId || !protocol || !fingerprint) {
          await kv.delete(k.name).catch(() => {});
          continue;
        }
        const rawValue = await kv.get(k.name);
        let parsed: { last_seen?: number; path?: string } | null = null;
        try {
          parsed = rawValue === null ? null : (JSON.parse(rawValue) as { last_seen?: number; path?: string });
        } catch {
          parsed = null; // malformed buffer entry - drop it below, never wedge the sweep
        }
        const lastSeen = typeof parsed?.last_seen === 'number' ? parsed.last_seen : null;
        if (lastSeen === null) {
          await kv.delete(k.name).catch(() => {});
          continue;
        }
        const lastPath = typeof parsed?.path === 'string' ? parsed.path : null;

        const upd = await db
          .prepare(UPDATE_SIGHTING_SQL)
          .bind(lastSeen, lastPath, depId, protocol, fingerprint)
          .run();
        if ((upd.meta?.changes ?? 0) > 0) {
          updated++;
        } else if (rowCount < cap) {
          await db.prepare(INSERT_SIGHTING_SQL).bind(depId, protocol, fingerprint, lastSeen, lastPath).run();
          inserted++;
          rowCount++;
        } else {
          const over = await db
            .prepare(UPDATE_SIGHTING_SQL)
            .bind(lastSeen, lastPath, depId, protocol, OVERFLOW_FINGERPRINT)
            .run();
          if ((over.meta?.changes ?? 0) === 0) {
            await db
              .prepare(INSERT_SIGHTING_SQL)
              .bind(depId, protocol, OVERFLOW_FINGERPRINT, lastSeen, lastPath)
              .run();
            rowCount++;
          }
          overflowed++;
        }
        flushed++;
        await kv.delete(k.name).catch(() => {});
      } catch (e) {
        errors.push(`sighting ${k.name}: ${msg(e)}`);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined && listed < maxKeys);

  return { listed, flushed, inserted, updated, overflowed, errors };
}

// -- Deletion policy as a query ----------------------------------------------

export const REMOVAL_QUIET_DAYS = 30;

/** Distinct identities seen on a deprecated surface since horizon (unix s). */
export async function countSightingsSince(
  db: D1Database,
  deprecationId: string,
  horizon: number,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM deprecation_sightings WHERE deprecation_id = ? AND last_seen >= ?',
    )
    .bind(deprecationId, horizon)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The X6 deletion policy: removing a surface requires ZERO identities seen in
 * the last REMOVAL_QUIET_DAYS. Overflow rows count too (conservative: capped
 * cardinality can hide WHO is still calling, never THAT someone is).
 */
export async function surfaceRemovalAllowed(
  db: D1Database,
  deprecationId: string,
  now: number,
): Promise<{ allowed: boolean; recentIdentities: number; horizon: number }> {
  const horizon = now - REMOVAL_QUIET_DAYS * 24 * 60 * 60;
  const recentIdentities = await countSightingsSince(db, deprecationId, horizon);
  return { allowed: recentIdentities === 0, recentIdentities, horizon };
}
