/**
 * Port Daddy Relay — D1 data access layer (ADR-0049)
 *
 * Thin wrappers around D1Database. All SQL is inline here; no ORM.
 * All writes use explicit transactions where chain integrity requires atomicity.
 */

import type {
  Env,
  ChainHead,
  IssuerConfig,
  RelayEvent,
} from './types.js';
import { randomHex } from './crypto.js';

// ── Identity registry ─────────────────────────────────────────────────────────

export interface IdentityRow {
  daemon_fingerprint: string;
  pub_key: string;
  proof_method: 'oidc' | 'acme' | 'wot';
  proof_metadata: string;  // JSON
  expires_at: number | null;
  revoked: number;
  revoked_reason: string | null;
}

export async function getIdentity(
  db: D1Database,
  fingerprint: string
): Promise<IdentityRow | null> {
  const row = await db.prepare(
    'SELECT * FROM identities WHERE daemon_fingerprint = ?'
  ).bind(fingerprint).first<IdentityRow>();
  return row ?? null;
}

export async function upsertIdentity(
  db: D1Database,
  row: Omit<IdentityRow, 'revoked' | 'revoked_reason'> & { revoked?: number; revoked_reason?: string }
): Promise<void> {
  await db.prepare(`
    INSERT INTO identities (daemon_fingerprint, pub_key, proof_method, proof_metadata, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (daemon_fingerprint) DO UPDATE SET
      pub_key = excluded.pub_key,
      proof_method = excluded.proof_method,
      proof_metadata = excluded.proof_metadata,
      expires_at = excluded.expires_at
  `).bind(
    row.daemon_fingerprint,
    row.pub_key,
    row.proof_method,
    row.proof_metadata,
    row.expires_at ?? null,
  ).run();
}

export async function revokeIdentity(
  db: D1Database,
  fingerprint: string,
  reason: string
): Promise<void> {
  await db.prepare(
    'UPDATE identities SET revoked = 1, revoked_reason = ? WHERE daemon_fingerprint = ?'
  ).bind(reason, fingerprint).run();
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface SessionRow {
  session_id: string;
  fingerprint: string;
  nonce_c: string;
  nonce_s: string;
  subs_json: string;
  created_at: number;
  expires_at: number;
}

export async function createSession(db: D1Database, row: SessionRow): Promise<void> {
  await db.prepare(`
    INSERT INTO sessions (session_id, fingerprint, nonce_c, nonce_s, subs_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.session_id,
    row.fingerprint,
    row.nonce_c,
    row.nonce_s,
    row.subs_json,
    row.created_at,
    row.expires_at,
  ).run();
}

export async function getSession(
  db: D1Database,
  sessionId: string
): Promise<SessionRow | null> {
  const row = await db.prepare(
    'SELECT * FROM sessions WHERE session_id = ?'
  ).bind(sessionId).first<SessionRow>();
  return row ?? null;
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface EventRow {
  sender: string;
  channel: string;
  seq: number;
  prev_hash: string;
  this_hash: string;
  iat: number;
  arrived_at: number;
  ciphertext: string;
  sig: string;
}

export async function getLastEventSeq(
  db: D1Database,
  sender: string,
  channel: string
): Promise<{ seq: number; this_hash: string } | null> {
  const row = await db.prepare(
    'SELECT seq, this_hash FROM events WHERE sender = ? AND channel = ? ORDER BY seq DESC LIMIT 1'
  ).bind(sender, channel).first<{ seq: number; this_hash: string }>();
  return row ?? null;
}

export async function insertEvent(db: D1Database, event: RelayEvent): Promise<void> {
  // Chain check then INSERT. D1 (Workers) does not support multi-statement transactions,
  // so we rely on the UNIQUE(sender,channel,seq) PK as the concurrent-write gate.
  // If two workers both pass the check and race to INSERT the same seq, the loser
  // gets SQLITE_CONSTRAINT which we surface as SEQ_CONFLICT (409) — not a 500.
  const last = await getLastEventSeq(db, event.sender, event.channel);
  const expectedSeq = last ? last.seq + 1 : 1;
  const expectedPrevHash = last ? last.this_hash : '0'.repeat(64);

  if (event.seq !== expectedSeq) {
    throw new ChainError('SEQ_MISMATCH', `Expected seq ${expectedSeq}, got ${event.seq}`);
  }
  if (event.prev_hash !== expectedPrevHash) {
    throw new ChainError('HASH_MISMATCH', `Expected prev_hash ${expectedPrevHash}`);
  }

  try {
    await db.prepare(`
      INSERT INTO events (sender, channel, seq, prev_hash, this_hash, iat, ciphertext, sig)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.sender,
      event.channel,
      event.seq,
      event.prev_hash,
      event.this_hash,
      event.iat,
      event.ciphertext,
      event.sig,
    ).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new ChainError('SEQ_CONFLICT', `Concurrent publish conflict at seq ${event.seq} — retry`);
    }
    throw e;
  }
}

export async function getEvents(
  db: D1Database,
  channel: string,
  fromSeq: number,
  limit = 100
): Promise<EventRow[]> {
  const rows = await db.prepare(
    'SELECT * FROM events WHERE channel = ? AND seq >= ? ORDER BY seq ASC LIMIT ?'
  ).bind(channel, fromSeq, limit).all<EventRow>();
  return rows.results;
}

// ── Chain heads ───────────────────────────────────────────────────────────────

export async function getChainHead(
  db: D1Database,
  sender: string,
  channel: string
): Promise<ChainHead | null> {
  const row = await db.prepare(
    'SELECT * FROM chain_heads WHERE sender = ? AND channel = ?'
  ).bind(sender, channel).first<{
    sender: string; channel: string; tip_seq: number; tip_hash: string;
    issued_at: number; signed_head: string; anchors_json: string | null;
  }>();
  if (!row) return null;
  return {
    sender: row.sender,
    channel: row.channel,
    tip_seq: row.tip_seq,
    tip_hash: row.tip_hash,
    issued_at: row.issued_at,
    signed_head: row.signed_head,
    anchors: row.anchors_json ? JSON.parse(row.anchors_json) : undefined,
  };
}

export async function upsertChainHead(
  db: D1Database,
  head: ChainHead
): Promise<void> {
  await db.prepare(`
    INSERT INTO chain_heads (sender, channel, tip_seq, tip_hash, issued_at, signed_head, anchors_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (sender, channel) DO UPDATE SET
      tip_seq = excluded.tip_seq,
      tip_hash = excluded.tip_hash,
      issued_at = excluded.issued_at,
      signed_head = excluded.signed_head,
      anchors_json = excluded.anchors_json
  `).bind(
    head.sender,
    head.channel,
    head.tip_seq,
    head.tip_hash,
    head.issued_at,
    head.signed_head,
    head.anchors ? JSON.stringify(head.anchors) : null,
  ).run();
}

// ── Revocations ───────────────────────────────────────────────────────────────

export async function isRevoked(db: D1Database, jti: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT jti FROM revocations WHERE jti = ?'
  ).bind(jti).first<{ jti: string }>();
  return row !== null;
}

export async function insertRevocation(
  db: D1Database,
  jti: string,
  revokingDaemon: string,
  reason?: string
): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO revocations (jti, revoking_daemon, reason)
    VALUES (?, ?, ?)
  `).bind(jti, revokingDaemon, reason ?? null).run();
}

// D1 caps results at 100k rows per query. revokeByIssuer paginates to avoid
// silently missing identities beyond that limit.
const REVOKE_PAGE_SIZE = 1000;

export async function revokeByIssuer(
  db: D1Database,
  issuer: string,
  iatMin: number,
  iatMax: number,
  reason: string
): Promise<string[]> {
  const affected: string[] = [];
  let offset = 0;

  while (true) {
    // Paginate through all OIDC identities — D1 query limit is 100k rows,
    // so we use small pages to stay within limits and avoid timeout risk.
    const rows = await db.prepare(
      `SELECT daemon_fingerprint, proof_metadata FROM identities
       WHERE proof_method = 'oidc'
       ORDER BY daemon_fingerprint ASC
       LIMIT ? OFFSET ?`
    ).bind(REVOKE_PAGE_SIZE, offset).all<{ daemon_fingerprint: string; proof_metadata: string }>();

    const inserts: Promise<D1Result>[] = [];

    for (const row of rows.results) {
      try {
        const meta = JSON.parse(row.proof_metadata) as { issuer?: string; jti?: string; iat?: number };
        if (
          meta.issuer === issuer &&
          typeof meta.iat === 'number' &&
          meta.iat >= iatMin &&
          meta.iat <= iatMax &&
          meta.jti
        ) {
          affected.push(meta.jti);
          inserts.push(
            db.prepare('INSERT OR IGNORE INTO revocations (jti, revoking_daemon, reason) VALUES (?, ?, ?)')
              .bind(meta.jti, 'relay-operator', reason)
              .run()
          );
        }
      } catch {
        // malformed proof_metadata — skip
      }
    }

    await Promise.all(inserts);

    // Last page — stop
    if (rows.results.length < REVOKE_PAGE_SIZE) break;
    offset += REVOKE_PAGE_SIZE;
  }
  return affected;
}

// ── Issuers ───────────────────────────────────────────────────────────────────

export async function getIssuer(
  db: D1Database,
  issuerId: string
): Promise<IssuerConfig | null> {
  const row = await db.prepare(
    'SELECT * FROM issuers WHERE issuer_id = ?'
  ).bind(issuerId).first<{
    issuer_id: string; jwks_uri: string; audience: string;
    disabled: number; disabled_at: number | null; last_fetch: number | null;
  }>();
  if (!row) return null;
  return {
    issuer_id: row.issuer_id,
    jwks_uri: row.jwks_uri,
    audience: row.audience,
    disabled: row.disabled === 1,
    disabled_at: row.disabled_at ?? undefined,
    last_fetch: row.last_fetch ?? undefined,
  };
}

export async function setIssuerDisabled(
  db: D1Database,
  issuerId: string,
  disabled: boolean
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    'UPDATE issuers SET disabled = ?, disabled_at = ? WHERE issuer_id = ?'
  ).bind(disabled ? 1 : 0, disabled ? now : null, issuerId).run();
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function appendAudit(
  db: D1Database,
  entry: {
    daemon_fingerprint?: string;
    action: string;
    target?: string;
    ip?: string;
    detail?: string;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_log (daemon_fingerprint, action, target, ip, detail)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    entry.daemon_fingerprint ?? null,
    entry.action,
    entry.target ?? null,
    entry.ip ?? null,
    entry.detail ?? null,
  ).run();
}

export async function queryAuditLog(
  db: D1Database,
  fingerprint: string,
  fromTs: number,
  toTs: number,
  limit = 500
): Promise<{ at: number; action: string; target: string | null; ip: string | null; detail: string | null }[]> {
  const rows = await db.prepare(
    'SELECT at, action, target, ip, detail FROM audit_log WHERE daemon_fingerprint = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ?'
  ).bind(fingerprint, fromTs, toTs, limit).all<{
    at: number; action: string; target: string | null; ip: string | null; detail: string | null;
  }>();
  return rows.results;
}

// ── Fleet observability (Phase C) ──────────────────────────────────────────────

export interface FleetRunRow {
  id: string;
  delivery_id: string;
  repo_full_name: string;
  pr_number: number;
  pr_url: string;
  head_sha: string;
  conclusion: string;
  ships_csv: string;
  neurons: number | null;
  ms: number;
  created_at: number;
}

export interface FleetRunStepRow {
  run_id: string;
  seq: number;
  kind: string;
  ship: string | null;
  title: string;
  detail: string | null;
  created_at: number;
}

/**
 * Insert (or idempotently no-op on retry) the run header. delivery_id is the
 * UNIQUE GitHub idempotency key, so a queue retry that re-creates the row is
 * absorbed by INSERT OR IGNORE rather than throwing SQLITE_CONSTRAINT.
 */
export async function insertFleetRun(
  db: D1Database,
  row: {
    id: string;
    delivery_id: string;
    repo_full_name: string;
    pr_number: number;
    pr_url: string;
    head_sha: string;
    conclusion?: string;
    ships_csv: string;
    neurons?: number | null;
    ms?: number;
    created_at?: number;
  }
): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO fleet_runs
      (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, neurons, ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id,
    row.delivery_id,
    row.repo_full_name,
    row.pr_number,
    row.pr_url,
    row.head_sha,
    row.conclusion ?? 'pending',
    row.ships_csv,
    row.neurons ?? null,
    row.ms ?? 0,
    row.created_at ?? Math.floor(Date.now() / 1000),
  ).run();
}

/** Patch the run header with its final conclusion + elapsed wall time. */
export async function finalizeFleetRun(
  db: D1Database,
  id: string,
  conclusion: string,
  ms: number,
  neurons?: number | null
): Promise<void> {
  await db.prepare(
    'UPDATE fleet_runs SET conclusion = ?, ms = ?, neurons = COALESCE(?, neurons) WHERE id = ?'
  ).bind(conclusion, ms, neurons ?? null, id).run();
}

/** Append one immutable transcript step. PK (run_id, seq) dedupes retries. */
export async function insertFleetRunStep(
  db: D1Database,
  step: {
    run_id: string;
    seq: number;
    kind: string;
    ship?: string | null;
    title: string;
    detail?: unknown;
    created_at?: number;
  }
): Promise<void> {
  const detail =
    step.detail === undefined || step.detail === null
      ? null
      : typeof step.detail === 'string'
        ? step.detail
        : JSON.stringify(step.detail);
  await db.prepare(`
    INSERT OR IGNORE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    step.run_id,
    step.seq,
    step.kind,
    step.ship ?? null,
    step.title,
    detail,
    step.created_at ?? Math.floor(Date.now() / 1000),
  ).run();
}

/** Recent fleet runs, newest first. */
export async function listFleetRuns(
  db: D1Database,
  limit = 50
): Promise<FleetRunRow[]> {
  const rows = await db.prepare(`
    SELECT id, delivery_id, repo_full_name, pr_number, pr_url, head_sha,
           conclusion, ships_csv, neurons, ms, created_at
    FROM fleet_runs
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all<FleetRunRow>();
  return rows.results;
}

/** One run + its ordered transcript, or null if the run id is unknown. */
export async function getFleetRunWithSteps(
  db: D1Database,
  runId: string
): Promise<{ run: FleetRunRow; steps: FleetRunStepRow[] } | null> {
  const run = await db.prepare(`
    SELECT id, delivery_id, repo_full_name, pr_number, pr_url, head_sha,
           conclusion, ships_csv, neurons, ms, created_at
    FROM fleet_runs WHERE id = ?
  `).bind(runId).first<FleetRunRow>();
  if (!run) return null;

  const steps = await db.prepare(`
    SELECT run_id, seq, kind, ship, title, detail, created_at
    FROM fleet_run_steps
    WHERE run_id = ?
    ORDER BY seq ASC
  `).bind(runId).all<FleetRunStepRow>();

  return { run, steps: steps.results };
}

/** unix-seconds timestamp of the most recent run, or null when none exist. */
export async function lastFleetRunAt(db: D1Database): Promise<number | null> {
  const row = await db.prepare(
    'SELECT created_at FROM fleet_runs ORDER BY created_at DESC LIMIT 1'
  ).first<{ created_at: number }>();
  return row ? row.created_at : null;
}

// ── Fleet kill switch (KV-backed) ──────────────────────────────────────────────

/** KV key holding the fleet pause flag. Shared with the executor's gate. */
export const FLEET_PAUSED_KEY = 'fleet:paused';

export interface FleetPausedState {
  paused: boolean;
  pausedAt: number;
}

/**
 * Read the kill-switch flag. Tolerates either the structured
 * `{paused, pausedAt}` JSON form or a bare `"true"`/`"false"` string.
 */
export async function getFleetPaused(kv: KVNamespace): Promise<boolean> {
  const raw = await kv.get(FLEET_PAUSED_KEY);
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  try {
    const parsed = JSON.parse(raw) as Partial<FleetPausedState>;
    return parsed.paused === true;
  } catch {
    return false;
  }
}

/** Write the kill-switch flag as structured JSON, stamping pausedAt. */
export async function setFleetPaused(
  kv: KVNamespace,
  paused: boolean
): Promise<FleetPausedState> {
  const state: FleetPausedState = { paused, pausedAt: Math.floor(Date.now() / 1000) };
  await kv.put(FLEET_PAUSED_KEY, JSON.stringify(state));
  return state;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ChainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChainError';
  }
}

// ── Users + web sessions (ADR-0101 Phase 1) ───────────────────────────────────

export interface UserRow {
  id: string;
  github_user_id: number;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  primary_email: string | null;
  email_verified: number;
  created_at: number;
  last_login_at: number | null;
  deleted_at: number | null;
}

/**
 * Upsert a user by durable github_user_id (logins can be renamed). Refreshes
 * the display fields + email + last_login_at on every login; un-deletes a
 * previously soft-deleted account on re-login. Returns the row.
 */
export async function upsertUser(
  db: D1Database,
  u: {
    githubUserId: number;
    login: string;
    displayName: string | null;
    avatarUrl: string | null;
    primaryEmail: string | null;
    emailVerified: boolean;
    now: number;
  },
): Promise<UserRow> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE github_user_id = ?')
    .bind(u.githubUserId)
    .first<UserRow>();
  const id = existing?.id ?? `u_${randomHex(16)}`;
  await db
    .prepare(
      `INSERT INTO users
         (id, github_user_id, login, display_name, avatar_url, primary_email, email_verified, created_at, last_login_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(github_user_id) DO UPDATE SET
         login = excluded.login,
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         primary_email = excluded.primary_email,
         email_verified = excluded.email_verified,
         last_login_at = excluded.last_login_at,
         deleted_at = NULL`,
    )
    .bind(
      id,
      u.githubUserId,
      u.login,
      u.displayName,
      u.avatarUrl,
      u.primaryEmail,
      u.emailVerified ? 1 : 0,
      existing?.created_at ?? u.now,
      u.now,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM users WHERE github_user_id = ?')
    .bind(u.githubUserId)
    .first<UserRow>();
  // We just INSERT..ON CONFLICT'd this row; a null read means the write silently
  // failed — surface it rather than returning a non-null lie via `!`.
  if (!row) throw new Error(`upsertUser: user ${u.githubUserId} not found after upsert`);
  return row;
}

export interface WebSessionRow {
  user: UserRow;
  gh_token_enc: string | null;
  gh_token_iv: string | null;
  expires_at: number;
}

export async function createWebSession(
  db: D1Database,
  row: {
    tokenHash: string;
    userId: string;
    ghTokenEnc: string | null;
    ghTokenIv: string | null;
    createdAt: number;
    expiresAt: number;
    userAgent: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO web_sessions (token_hash, user_id, gh_token_enc, gh_token_iv, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.tokenHash, row.userId, row.ghTokenEnc, row.ghTokenIv, row.createdAt, row.expiresAt, row.userAgent)
    .run();
}

/** Resolve a session token hash to its (unexpired-agnostic) row + joined user. */
export async function getWebSession(db: D1Database, tokenHash: string): Promise<WebSessionRow | null> {
  const s = await db
    .prepare('SELECT user_id, gh_token_enc, gh_token_iv, expires_at FROM web_sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string; gh_token_enc: string | null; gh_token_iv: string | null; expires_at: number }>();
  if (!s) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(s.user_id).first<UserRow>();
  if (!user) return null;
  return { user, gh_token_enc: s.gh_token_enc, gh_token_iv: s.gh_token_iv, expires_at: s.expires_at };
}

export async function deleteWebSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM web_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

// ── user_tokens: pdu_ personal access tokens (ADR-0101 Phase 1 device flow) ───

export interface UserTokenRow {
  token_hash: string;
  user_id: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

/** Store a minted pdu_ token (only its SHA-256). */
export async function createUserToken(
  db: D1Database,
  row: { tokenHash: string; userId: string; label: string; createdAt: number; expiresAt: number | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_tokens (token_hash, user_id, label, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(row.tokenHash, row.userId, row.label, row.createdAt, row.expiresAt)
    .run();
}

/**
 * Resolve a pdu_ token hash to its live (non-revoked, unexpired) user, bumping
 * last_used_at. Returns null for unknown/revoked/expired tokens or deleted users.
 */
export async function resolveUserToken(db: D1Database, tokenHash: string, now: number): Promise<UserRow | null> {
  const t = await db
    .prepare('SELECT user_id, expires_at, revoked_at FROM user_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number | null; revoked_at: number | null }>();
  if (!t || t.revoked_at != null) return null;
  if (t.expires_at != null && t.expires_at <= now) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(t.user_id).first<UserRow>();
  if (!user) return null;
  await db.prepare('UPDATE user_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  return user;
}

/** A user's tokens (metadata only — never the token). */
export async function listUserTokens(db: D1Database, userId: string): Promise<UserTokenRow[]> {
  const r = await db
    .prepare('SELECT * FROM user_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(userId)
    .all<UserTokenRow>();
  return r.results ?? [];
}

/** Revoke one of a user's tokens by hash (scoped to the user; idempotent). */
export async function revokeUserToken(db: D1Database, userId: string, tokenHash: string, now: number): Promise<boolean> {
  const r = await db
    .prepare('UPDATE user_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now, tokenHash, userId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Count a user's live sessions (metadata for the self-service account export). */
export async function countUserSessions(db: D1Database, userId: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM web_sessions WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Account erasure (ADR-0101 team-tier delete control): soft-delete the user row
 * NOW and purge every session immediately (log the account out everywhere); a
 * separate retention job hard-deletes soft-deleted rows within 30 days. Returns
 * how many sessions were purged.
 */
export async function eraseUser(db: D1Database, userId: string, now: number): Promise<number> {
  const sessions = await db.prepare('DELETE FROM web_sessions WHERE user_id = ?').bind(userId).run();
  // Revoke every pdu_ device token too — erasure logs out browsers AND devices.
  await db.prepare('UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId).run();
  await db
    .prepare('UPDATE users SET deleted_at = ?, primary_email = NULL, avatar_url = NULL WHERE id = ?')
    .bind(now, userId)
    .run();
  return sessions.meta?.changes ?? 0;
}

/**
 * Delete one fleet run + its transcript (ADR-0101 export/delete per-tier gate,
 * repo tier). Returns how many run rows were removed (0 if unknown id).
 */
export async function deleteFleetRun(db: D1Database, runId: string): Promise<number> {
  await db.prepare('DELETE FROM fleet_run_steps WHERE run_id = ?').bind(runId).run();
  const res = await db.prepare('DELETE FROM fleet_runs WHERE id = ?').bind(runId).run();
  return res.meta?.changes ?? 0;
}
