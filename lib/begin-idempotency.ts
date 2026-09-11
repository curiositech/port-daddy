/**
 * Begin idempotency — exactly-once `pd begin` across a lost response.
 *
 * The problem this closes: `POST /sugar/begin` creates and commits a session,
 * then the response is lost on the wire (socket reset, client timeout). Every
 * pd transport re-sends the identical body on those failures
 * (cli/utils/fetch.ts socket→TCP fallback, lib/client.ts `_request`), and
 * before this store the daemon treated the re-send as a brand-new begin:
 * either a second agent + session (the first orphaned with its claims and
 * rent) or, when the identity-resume path found the first session, a 403
 * because the retry could not present the credential that was in the lost
 * response. The credential is returned exactly once, so the agent could never
 * drive or close the session it had just created.
 *
 * The contract: the client mints one key per LOGICAL begin and sends it on
 * every re-send of that attempt. The daemon records `(key → session)` next to
 * the session; a later begin carrying a known key returns the ORIGINAL
 * session — same ids, same credential — flagged `replayed: true`, and never
 * mints again.
 *
 * Key scope. A key is only honoured for the same (identity, asserted agentId,
 * worktree) it was recorded under, so a key that leaks from a different
 * context cannot be replayed to obtain another agent's session. A request
 * fingerprint (purpose, lifecycle, files, rent) is recorded too: the same key
 * reused for a DIFFERENT begin is refused rather than silently answered with
 * the old session.
 *
 * Credential replay. The minted credential is the one thing a lost response
 * takes with it, so the store keeps it — but sealed under the idempotency key
 * itself (HKDF → AES-256-GCM). Only the key's hash is stored, so the daemon
 * database cannot yield the plaintext credential; only the caller who holds
 * the key (the one that made the begin) can open the seal. That preserves the
 * "returned once" property against everyone except the original requester.
 *
 * Retention. Records expire after `ttlMs` (default 24h); an expired record is
 * treated as unknown, and a record whose session has since closed is also
 * ignored by the route (a new begin under an old key after `pd done` is a new
 * begin, not a replay of finished work).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { Database } from 'better-sqlite3';

/** Accepted key shape: opaque, URL-safe, 16..128 chars (UUID v4 / ULID / hex). */
export const BEGIN_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{16,128}$/;

const KEY_HASH_DOMAIN = 'pd-begin-idempotency-v1';
const SEAL_SALT = 'pd-begin-idempotency-v1';
const SEAL_INFO = 'credential-seal';
const SEAL_VERSION = 'v1';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Check whether a value can be used as a begin idempotency key.
 *
 * @param value - Candidate key from a request body or header.
 * @returns True when the value matches {@link BEGIN_IDEMPOTENCY_KEY_PATTERN}.
 * @example
 * isValidBeginIdempotencyKey(generateBeginIdempotencyKey()); // true
 * isValidBeginIdempotencyKey('short'); // false
 */
export function isValidBeginIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && BEGIN_IDEMPOTENCY_KEY_PATTERN.test(value);
}

/**
 * Mint a fresh key for one logical begin attempt (UUID v4, 122 random bits).
 *
 * @returns A key accepted by {@link isValidBeginIdempotencyKey}.
 * @example
 * const key = generateBeginIdempotencyKey();
 * // send `key` on the first request AND on every retry of the same attempt
 */
export function generateBeginIdempotencyKey(): string {
  return randomUUID();
}

/** The context a key is bound to; a replay from another context is refused. */
export interface BeginIdempotencyScope {
  identity: string | null;
  agentId: string | null;
  worktreeId: string | null;
}

/**
 * Canonical scope string for a begin request.
 *
 * @param scope - Identity / asserted agentId / worktree of the request.
 * @returns A stable string equal for two requests from the same context.
 * @example
 * beginScopeKey({ identity: 'app:api:main', agentId: null, worktreeId: 'wt1' })
 * // '{"agentId":null,"identity":"app:api:main","worktreeId":"wt1"}'
 */
export function beginScopeKey(scope: BeginIdempotencyScope): string {
  return JSON.stringify({
    agentId: scope.agentId ?? null,
    identity: scope.identity ?? null,
    worktreeId: scope.worktreeId ?? null,
  });
}

/**
 * Fingerprint the parts of a begin body that define WHICH begin this is.
 * Two re-sends of one attempt share it; a different begin under a reused key
 * does not, and is refused rather than answered with the old session.
 *
 * @param body - The raw begin request body.
 * @returns A hex sha256 over the canonical subset.
 * @example
 * beginRequestFingerprint({ purpose: 'x', lifecycle: 'ephemeral' })
 *   === beginRequestFingerprint({ lifecycle: 'ephemeral', purpose: 'x' }); // true
 */
export function beginRequestFingerprint(body: Record<string, unknown>): string {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);
  const files = Array.isArray(body.files)
    ? [...(body.files as unknown[])].filter((f): f is string => typeof f === 'string').sort()
    : [];
  const canonical = JSON.stringify({
    purpose: str(body.purpose),
    lifecycle: str(body.lifecycle),
    identity: str(body.identity),
    agentId: str(body.agentId),
    name: str(body.name),
    type: str(body.type),
    force: body.force === true,
    files,
    roadmapLink: str(body.roadmapLink),
    sidequestReason: str(body.sidequestReason),
    roadmapNewTitle: str(body.roadmapNewTitle),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** One recorded begin, keyed by the hash of its idempotency key. */
export interface BeginIdempotencyRecord {
  keyHash: string;
  scope: string;
  fingerprint: string;
  sessionId: string;
  agentId: string;
  actorId: string | null;
  /** The success response as returned the first time, minus the credential. */
  response: Record<string, unknown>;
  credentialSealed: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface BeginIdempotencyConfig {
  /** How long a key stays replayable. Default 24h. */
  ttlMs?: number;
  now?: () => number;
}

function hashKey(key: string): string {
  return createHash('sha256').update(`${KEY_HASH_DOMAIN}|${key}`).digest('hex');
}

function sealKey(key: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, SEAL_SALT, SEAL_INFO, 32));
}

/**
 * Seal a credential under an idempotency key (AES-256-GCM, HKDF-derived key).
 *
 * @param credential - The plaintext daemon-minted credential.
 * @param key - The idempotency key the caller holds.
 * @returns An opaque `v1.<iv>.<tag>.<ciphertext>` string.
 * @example
 * const sealed = sealCredential('actor.secret', key);
 * unsealCredential(sealed, key); // 'actor.secret'
 */
export function sealCredential(credential: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SEAL_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/**
 * Open a credential seal with the idempotency key that produced it.
 *
 * @param sealed - Output of {@link sealCredential}.
 * @param key - The same idempotency key.
 * @returns The plaintext credential, or null when the key is wrong or the
 *          seal is malformed (never throws; a failed unseal is "not yours").
 * @example
 * unsealCredential(sealCredential('c', 'k'.repeat(16)), 'x'.repeat(16)); // null
 */
export function unsealCredential(sealed: string, key: string): string | null {
  try {
    const [version, ivB64, tagB64, ctB64] = sealed.split('.');
    if (version !== SEAL_VERSION || !ivB64 || !tagB64 || !ctB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', sealKey(key), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

interface Row {
  key_hash: string;
  scope: string;
  fingerprint: string;
  session_id: string;
  agent_id: string;
  actor_id: string | null;
  response_json: string;
  credential_sealed: string | null;
  created_at: number;
  expires_at: number;
}

function rowToRecord(row: Row): BeginIdempotencyRecord {
  let response: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.response_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) response = parsed as Record<string, unknown>;
  } catch {}
  return {
    keyHash: row.key_hash,
    scope: row.scope,
    fingerprint: row.fingerprint,
    sessionId: row.session_id,
    agentId: row.agent_id,
    actorId: row.actor_id,
    response,
    credentialSealed: row.credential_sealed,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Create the begin idempotency store on a daemon database. Owns its DDL
 * (additive `CREATE TABLE IF NOT EXISTS`, safe on every pre-existing DB).
 *
 * @param db - The daemon's SQLite handle.
 * @param config - Retention and clock overrides (tests).
 * @returns The store: `lookup`, `record`, `forget`, `sweep`, `openCredential`.
 * @example
 * const store = createBeginIdempotency(db);
 * store.record({ key, scope, fingerprint, sessionId, agentId, actorId, response, credential });
 * store.lookup(key)?.sessionId; // the original session on a retry
 */
export function createBeginIdempotency(db: Database, config: BeginIdempotencyConfig = {}) {
  const ttlMs = Math.max(1000, config.ttlMs ?? DEFAULT_TTL_MS);
  const now = config.now ?? Date.now;

  db.prepare(`
    CREATE TABLE IF NOT EXISTS begin_idempotency (
      key_hash          TEXT PRIMARY KEY,
      scope             TEXT NOT NULL,
      fingerprint       TEXT NOT NULL,
      session_id        TEXT NOT NULL,
      agent_id          TEXT NOT NULL,
      actor_id          TEXT,
      response_json     TEXT NOT NULL,
      credential_sealed TEXT,
      created_at        INTEGER NOT NULL,
      expires_at        INTEGER NOT NULL
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_begin_idempotency_session ON begin_idempotency(session_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_begin_idempotency_expires ON begin_idempotency(expires_at)').run();

  const stmts = {
    get: db.prepare('SELECT * FROM begin_idempotency WHERE key_hash = ?'),
    upsert: db.prepare(`
      INSERT INTO begin_idempotency
        (key_hash, scope, fingerprint, session_id, agent_id, actor_id, response_json, credential_sealed, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET
        scope = excluded.scope,
        fingerprint = excluded.fingerprint,
        session_id = excluded.session_id,
        agent_id = excluded.agent_id,
        actor_id = excluded.actor_id,
        response_json = excluded.response_json,
        credential_sealed = excluded.credential_sealed,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `),
    del: db.prepare('DELETE FROM begin_idempotency WHERE key_hash = ?'),
    sweep: db.prepare('DELETE FROM begin_idempotency WHERE expires_at <= ?'),
  };

  /**
   * Find the begin recorded under a key. Expired records are removed and
   * reported as unknown.
   *
   * @param key - The client's idempotency key (plaintext; only its hash is compared).
   * @returns The record, or null when unknown / expired / key invalid.
   */
  function lookup(key: string): BeginIdempotencyRecord | null {
    if (!isValidBeginIdempotencyKey(key)) return null;
    const row = stmts.get.get(hashKey(key)) as Row | undefined;
    if (!row) return null;
    if (row.expires_at <= now()) {
      stmts.del.run(row.key_hash);
      return null;
    }
    return rowToRecord(row);
  }

  /**
   * Record a successful begin under its key. Replaces any earlier record for
   * the same key (a key whose session has closed is legitimately re-recorded
   * by the next fresh begin).
   *
   * @param params - Key, scope, fingerprint, the created ids, the response to
   *        replay (the credential is stripped and sealed separately).
   */
  function record(params: {
    key: string;
    scope: BeginIdempotencyScope | string;
    fingerprint: string;
    sessionId: string;
    agentId: string;
    actorId: string | null;
    response: Record<string, unknown>;
    credential: string | null;
  }): void {
    if (!isValidBeginIdempotencyKey(params.key)) {
      throw new Error('begin idempotency key must match ' + BEGIN_IDEMPOTENCY_KEY_PATTERN.source);
    }
    const { credential: _stripped, ...replayable } = params.response;
    void _stripped;
    const ts = now();
    stmts.upsert.run(
      hashKey(params.key),
      typeof params.scope === 'string' ? params.scope : beginScopeKey(params.scope),
      params.fingerprint,
      params.sessionId,
      params.agentId,
      params.actorId,
      JSON.stringify(replayable),
      params.credential ? sealCredential(params.credential, params.key) : null,
      ts,
      ts + ttlMs,
    );
  }

  /**
   * Open the sealed credential of a record with the caller's key.
   *
   * @param record - A record from {@link lookup}.
   * @param key - The caller's plaintext key.
   * @returns The credential, or null when none was sealed or the key is wrong.
   */
  function openCredential(record: BeginIdempotencyRecord, key: string): string | null {
    if (!record.credentialSealed) return null;
    return unsealCredential(record.credentialSealed, key);
  }

  /**
   * Drop a key's record (e.g. when its session is deleted).
   *
   * @param key - The plaintext key.
   * @returns True when a record was removed.
   */
  function forget(key: string): boolean {
    if (!isValidBeginIdempotencyKey(key)) return false;
    return stmts.del.run(hashKey(key)).changes > 0;
  }

  /**
   * Remove every expired record.
   *
   * @returns The number of records removed.
   */
  function sweep(): number {
    return stmts.sweep.run(now()).changes;
  }

  return { lookup, record, openCredential, forget, sweep, ttlMs };
}

export type BeginIdempotency = ReturnType<typeof createBeginIdempotency>;
