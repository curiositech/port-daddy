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
  proof_method: 'oidc' | 'acme' | 'wot' | 'operator-provisioned';
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

/**
 * Every chain head on ONE channel, across senders.
 *
 * Chains are per (sender, channel), so a channel can legitimately carry one
 * head per writer — but some channels have exactly one AUTHORIZED writer
 * (e.g. the fleet executor's per-run fleet-cloud run channels). This query is
 * the raw material for chain-head anomaly detection: see
 * detectChainHeadAnomalies in src/fleet-executor-identity.ts.
 */
export async function listChainHeadsForChannel(
  db: D1Database,
  channel: string
): Promise<ChainHead[]> {
  const rows = await db.prepare(
    'SELECT * FROM chain_heads WHERE channel = ? ORDER BY sender ASC'
  ).bind(channel).all<{
    sender: string; channel: string; tip_seq: number; tip_hash: string;
    issued_at: number; signed_head: string; anchors_json: string | null;
  }>();
  return rows.results.map((row) => ({
    sender: row.sender,
    channel: row.channel,
    tip_seq: row.tip_seq,
    tip_hash: row.tip_hash,
    issued_at: row.issued_at,
    signed_head: row.signed_head,
    ...(row.anchors_json ? { anchors: JSON.parse(row.anchors_json) } : {}),
  }));
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
    // Paginate through all issuer-scoped identities (OIDC exchanges AND
    // operator-provisioned fleet-executor identities, whose proof_metadata
    // records the same {issuer, jti, iat} shape) — D1 query limit is 100k
    // rows, so we use small pages to stay within limits and avoid timeout risk.
    const rows = await db.prepare(
      `SELECT daemon_fingerprint, proof_metadata FROM identities
       WHERE proof_method IN ('oidc', 'operator-provisioned')
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

/** Write one retry-replaceable transcript telemetry step. PK (run_id, seq) dedupes retries. */
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
 * Resolve a pdu_ token hash to its live (non-revoked, unexpired) user without
 * mutating token metadata. Use this for polling and other read-heavy paths.
 */
export async function resolveUserTokenReadOnly(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<UserRow | null> {
  const t = await db
    .prepare('SELECT user_id, expires_at, revoked_at FROM user_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number | null; revoked_at: number | null }>();
  if (!t || t.revoked_at != null) return null;
  if (t.expires_at != null && t.expires_at <= now) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(t.user_id).first<UserRow>();
  if (!user) return null;
  return user;
}

/**
 * Resolve a pdu_ token hash and record interactive use. Polling surfaces should
 * call {@link resolveUserTokenReadOnly} so refreshes do not amplify D1 writes.
 */
export async function resolveUserToken(db: D1Database, tokenHash: string, now: number): Promise<UserRow | null> {
  const user = await resolveUserTokenReadOnly(db, tokenHash, now);
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

// ── user_roles: relay operator authorization (ADR-0101 Phase 1) ─────────────

export type UserRole = 'operator';

/**
 * Check one account role without trusting a client-supplied claim.
 *
 * @param db Relay D1 binding that owns the authoritative role ledger.
 * @param userId Internal user id resolved from a live cookie or pdu_ token.
 * @param role Closed role name; only operator exists in Phase 1.
 * @returns True only when the durable role row exists.
 */
export async function hasUserRole(db: D1Database, userId: string, role: UserRole): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS allowed FROM user_roles WHERE user_id = ? AND role = ?')
    .bind(userId, role)
    .first<{ allowed: number }>();
  return row?.allowed === 1;
}

/**
 * Materialize a server-configured role idempotently.
 *
 * The caller must first prove the account matches trusted server configuration;
 * this helper intentionally accepts an internal user id, never a request field.
 *
 * @param db Relay D1 binding that owns the authoritative role ledger.
 * @param userId Internal user id to grant.
 * @param role Closed role name; only operator exists in Phase 1.
 * @param source Durable provenance for operator diagnostics.
 * @param grantedAt Relay-clock unix seconds.
 */
export async function grantUserRole(
  db: D1Database,
  userId: string,
  role: UserRole,
  source: string,
  grantedAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_roles (user_id, role, source, granted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, role) DO NOTHING`,
    )
    .bind(userId, role, source, grantedAt)
    .run();
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
  // Read the login BEFORE the soft-delete: it is the key to this user's public
  // skill namespace (seamanship.ts publishes under '@<login>'), and the users
  // row is about to be scrubbed.
  const who = await db.prepare('SELECT login FROM users WHERE id = ?').bind(userId).first<{ login: string }>();
  const login = who?.login ?? null;
  const sessions = await db.prepare('DELETE FROM web_sessions WHERE user_id = ?').bind(userId).run();
  // Revoke every pdu_ device token too — erasure logs out browsers AND devices.
  await db.prepare('UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId).run();
  // Roles are account metadata and must not survive erasure or block the later
  // hard delete through their users(id) foreign key.
  await db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId).run();
  // Shipwright chat content is user-authored PII — it dies NOW, not in 30 days.
  await db.prepare('DELETE FROM shipwright_chats WHERE user_id = ?').bind(userId).run();
  // Seamanship: the frontmatter cache was read under THIS user's installation
  // grant, so it dies with the grant. It is only a cache — nothing is lost that
  // the repo does not still hold.
  await db.prepare('DELETE FROM seamanship_skill_cache WHERE user_id = ?').bind(userId).run();
  // The Engineman's chat is user-authored PII on the same footing as the other
  // conversation store — it dies NOW.
  await db.prepare('DELETE FROM agent_chats WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM agent_chat_spend WHERE user_id = ?').bind(userId).run();
  // Build capabilities die FIRST among the Snipe rows: an unspent grant is a
  // pull request waiting to happen, and an erased account must not still be
  // able to author into a repo. Grants before suggestions, because the grant
  // references the suggestion.
  await db.prepare('DELETE FROM seamanship_build_grants WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM seamanship_suggestions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM seamanship_suggestion_jobs WHERE user_id = ?').bind(userId).run();
  // ...and their public skill listing comes down NOW. An erased account must not
  // keep publishing a directory of its owner's skills for the next 30 days.
  // Keyed by login, not users.id: the namespace IS the login (seamanship.ts).
  if (login) await db.prepare('DELETE FROM skill_listings WHERE namespace = ?').bind(login).run();
  // Roadmap mirrors are the account's own pushed roadmap replicas (ADR-0101
  // Critical-2 delete control, team tier) — all four tables die NOW too. The
  // daemon keeps its local source of record; only the cloud replica is erased.
  await db.prepare('DELETE FROM roadmap_mirror_items WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM roadmap_mirror_edges WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM roadmap_mirror_activity WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM roadmap_mirrors WHERE user_id = ?').bind(userId).run();
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

// ── Remote harbors (grand-plan X2 v1: keypair + namespace + membership) ───────
//
// NOTE: harbor_memberships is deliberately NOT the legacy zero-trust
// `harbor_members` daemon-admission table gated by the handshake/publish path
// above the crypto boundary (handlers.ts). Rows here are operator-plane
// (session/pdu auth) and grant API visibility only — never channel publish.

export interface HarborRow {
  id: string;
  namespace: string;
  name: string;
  pubkey: string;
  created_by: string;
  created_at: number;
  /**
   * ADR-0122 §4's membership-change clock on the X2 registry row: ticks on
   * every membership write (join, operator add-member). A change COUNTER of
   * the phone book, not an authority grant — the relay signs nothing and
   * holds no writer lease; the signed authority record stays with the owning
   * daemon (ADR-0122 §2–3). Starts at 1 (creation with the founding owner).
   */
  authority_epoch: number;
}

export type HarborRole = 'owner' | 'member';
export type HarborMemberKind = 'user' | 'daemon';

export interface HarborMemberListRow {
  member_kind: HarborMemberKind;
  member_id: string;
  role: HarborRole;
  added_at: number;
  /** GitHub login for 'user' members (joined); null for daemons / erased users. */
  login: string | null;
}

export function isUniqueViolation(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes('UNIQUE constraint failed') || m.includes('SQLITE_CONSTRAINT');
}

/**
 * Create a harbor plus its creator's 'owner' membership atomically (D1 batch —
 * a harbor without an owner could never gain members, so the two rows must
 * land together). Returns 'duplicate' when (namespace, name) is taken.
 */
export async function createHarbor(
  db: D1Database,
  h: { id: string; namespace: string; name: string; pubkey: string; createdBy: string; createdAt: number },
): Promise<'ok' | 'duplicate'> {
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO harbors (id, namespace, name, pubkey, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(h.id, h.namespace, h.name, h.pubkey, h.createdBy, h.createdAt),
      db.prepare(
        'INSERT INTO harbor_memberships (harbor_id, member_kind, member_id, role, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(h.id, 'user', h.createdBy, 'owner', h.createdAt, h.createdBy),
    ]);
    return 'ok';
  } catch (e) {
    if (isUniqueViolation(e)) return 'duplicate';
    throw e;
  }
}

export async function getHarborByName(
  db: D1Database,
  namespace: string,
  name: string,
): Promise<HarborRow | null> {
  const row = await db
    .prepare('SELECT id, namespace, name, pubkey, created_by, created_at, authority_epoch FROM harbors WHERE namespace = ? AND name = ?')
    .bind(namespace, name)
    .first<HarborRow>();
  return row ?? null;
}

/** The caller's role in a harbor, or null when not a member (the authz gate). */
export async function getHarborRole(
  db: D1Database,
  harborId: string,
  kind: HarborMemberKind,
  memberId: string,
): Promise<HarborRole | null> {
  const row = await db
    .prepare('SELECT role FROM harbor_memberships WHERE harbor_id = ? AND member_kind = ? AND member_id = ?')
    .bind(harborId, kind, memberId)
    .first<{ role: HarborRole }>();
  return row?.role ?? null;
}

/**
 * Record a membership AND tick the harbor's authority-epoch clock in one
 * atomic D1 batch (ADR-0122 §4: every membership change bumps the epoch —
 * this is the single membership-write path, so the clock cannot miss a
 * change). A duplicate INSERT aborts the whole batch, so an already-member
 * write never bumps the epoch: the clock counts CHANGES, not attempts.
 * Returns 'duplicate' when the (harbor, kind, member) row already exists.
 */
export async function addHarborMembership(
  db: D1Database,
  m: { harborId: string; kind: HarborMemberKind; memberId: string; role: HarborRole; addedAt: number; addedBy: string },
): Promise<'ok' | 'duplicate'> {
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO harbor_memberships (harbor_id, member_kind, member_id, role, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(m.harborId, m.kind, m.memberId, m.role, m.addedAt, m.addedBy),
      db
        .prepare('UPDATE harbors SET authority_epoch = authority_epoch + 1 WHERE id = ?')
        .bind(m.harborId),
    ]);
    return 'ok';
  } catch (e) {
    if (isUniqueViolation(e)) return 'duplicate';
    throw e;
  }
}

/** Every member of a harbor with user logins joined in (member-gated read). */
export async function listHarborMembers(db: D1Database, harborId: string): Promise<HarborMemberListRow[]> {
  const r = await db
    .prepare(
      `SELECT m.member_kind, m.member_id, m.role, m.added_at, u.login
       FROM harbor_memberships m
       LEFT JOIN users u ON m.member_kind = 'user' AND u.id = m.member_id
       WHERE m.harbor_id = ?
       ORDER BY m.added_at ASC, m.member_id ASC`,
    )
    .bind(harborId)
    .all<HarborMemberListRow>();
  return r.results ?? [];
}

/** Harbors the user belongs to ("mine"), newest first, each with their role. */
export async function listHarborsForUser(
  db: D1Database,
  userId: string,
): Promise<Array<HarborRow & { role: HarborRole }>> {
  const r = await db
    .prepare(
      `SELECT h.id, h.namespace, h.name, h.pubkey, h.created_by, h.created_at, h.authority_epoch, m.role
       FROM harbors h
       JOIN harbor_memberships m ON m.harbor_id = h.id
       WHERE m.member_kind = 'user' AND m.member_id = ?
       ORDER BY h.created_at DESC, h.id ASC`,
    )
    .bind(userId)
    .all<HarborRow & { role: HarborRole }>();
  return r.results ?? [];
}

// ── Device keys (WS-B slice B3) ────────────────────────────────────────────
//
// device_id is made globally unique by the migration's
// device_keys_device_id_idx (see migrations/2026-08-26-b3-device-keys.sql) —
// getDeviceKeyOwner below assumes that constraint; it is what lets a bare
// device_id resolve to its owning account with one indexed lookup.

export interface DeviceKeyRow {
  user_id: string;
  device_id: string;
  x25519_pubkey: string;
  created_at: number;
  updated_at: number;
}

/**
 * Upsert (user_id, device_id) → pubkey. Returns 'rotated' if this updated an
 * existing (user_id, device_id) row, 'inserted' if it created one, or
 * 'conflict' if device_id is already claimed by a DIFFERENT user_id.
 *
 * device_id is globally unique (device_keys_device_id_idx, on top of the
 * (user_id, device_id) primary key) so a caller-chosen id can collide across
 * accounts, not just within one — that's a routine, client-triggerable case
 * (DEVICE_ID_RE accepts any 1-128 char string), not a theoretical one. The
 * ON CONFLICT clause below only names the PK, so a cross-account collision
 * hits the OTHER unique index and throws instead of upserting; any
 * unique-violation caught here is necessarily that case, since a same-account
 * collision would have gone through ON CONFLICT and never thrown at all.
 */
export async function upsertDeviceKey(
  db: D1Database,
  k: { userId: string; deviceId: string; pubkey: string; now: number },
): Promise<'inserted' | 'rotated' | 'conflict'> {
  const existing = await db
    .prepare('SELECT 1 FROM device_keys WHERE user_id = ? AND device_id = ?')
    .bind(k.userId, k.deviceId)
    .first();
  try {
    await db
      .prepare(
        `INSERT INTO device_keys (user_id, device_id, x25519_pubkey, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, device_id) DO UPDATE SET
           x25519_pubkey = excluded.x25519_pubkey, updated_at = excluded.updated_at`,
      )
      .bind(k.userId, k.deviceId, k.pubkey, k.now, k.now)
      .run();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return 'conflict';
  }
  return existing !== null ? 'rotated' : 'inserted';
}

export async function getDeviceKey(db: D1Database, userId: string, deviceId: string): Promise<DeviceKeyRow | null> {
  const row = await db
    .prepare('SELECT * FROM device_keys WHERE user_id = ? AND device_id = ?')
    .bind(userId, deviceId)
    .first<DeviceKeyRow>();
  return row ?? null;
}

export async function listDeviceKeys(db: D1Database, userId: string): Promise<DeviceKeyRow[]> {
  const r = await db
    .prepare('SELECT * FROM device_keys WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<DeviceKeyRow>();
  return r.results ?? [];
}

/**
 * Resolve a device_id to its owning account, ASSUMING device_id is made
 * globally unique by the migration's device_keys_device_id_idx.
 */
export async function getDeviceKeyOwner(
  db: D1Database,
  deviceId: string,
): Promise<{ userId: string; pubkey: string; updatedAt: number } | null> {
  const row = await db
    .prepare('SELECT user_id, x25519_pubkey, updated_at FROM device_keys WHERE device_id = ?')
    .bind(deviceId)
    .first<{ user_id: string; x25519_pubkey: string; updated_at: number }>();
  return row ? { userId: row.user_id, pubkey: row.x25519_pubkey, updatedAt: row.updated_at } : null;
}

// ── Harbor key wraps (WS-B slice B3) ───────────────────────────────────────
//
// Every column here mirrors lib/pd-vault-ts.ts's KeyWrapAad + WrappedKey wire
// shapes field-for-field (see the migration's comment). enc/ciphertext are
// Base64URL TEXT, opaque to the relay — never decoded, never inspected here.

export interface HarborKeyWrapRow {
  harbor_id: string;
  authority_epoch: number;
  recipient_device_id: string;
  key_purpose: string;
  key_id: string;
  grant: string;
  recipient_user_id: string;
  enc: string;
  ciphertext: string;
  wrapped_by: string;
  created_at: number;
}

/**
 * Insert one wrap. 'conflict' when the (harbor,epoch,device,purpose,keyId)
 * coordinate is already occupied by a DIFFERENT enc/ciphertext; 'replay' when
 * it is occupied by the byte-identical enc+ciphertext (idempotent retry);
 * 'ok' on a fresh insert. Mirrors the CAS-then-disambiguate idiom
 * consumeHarborInvite/createHarborInvite already use in this file.
 */
export async function insertHarborKeyWrap(
  db: D1Database,
  w: {
    harborId: string;
    authorityEpoch: number;
    recipientDeviceId: string;
    keyPurpose: string;
    keyId: string;
    grant: string;
    recipientUserId: string;
    enc: string;
    ciphertext: string;
    wrappedBy: string;
    now: number;
  },
): Promise<'ok' | 'replay' | 'conflict'> {
  try {
    await db
      .prepare(
        `INSERT INTO harbor_key_wraps
           (harbor_id, authority_epoch, recipient_device_id, key_purpose, key_id, grant,
            recipient_user_id, enc, ciphertext, wrapped_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        w.harborId,
        w.authorityEpoch,
        w.recipientDeviceId,
        w.keyPurpose,
        w.keyId,
        w.grant,
        w.recipientUserId,
        w.enc,
        w.ciphertext,
        w.wrappedBy,
        w.now,
      )
      .run();
    return 'ok';
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await db
      .prepare(
        `SELECT enc, ciphertext FROM harbor_key_wraps
         WHERE harbor_id = ? AND authority_epoch = ? AND recipient_device_id = ? AND key_purpose = ? AND key_id = ?`,
      )
      .bind(w.harborId, w.authorityEpoch, w.recipientDeviceId, w.keyPurpose, w.keyId)
      .first<{ enc: string; ciphertext: string }>();
    return existing && existing.enc === w.enc && existing.ciphertext === w.ciphertext ? 'replay' : 'conflict';
  }
}

export async function listHarborKeyWraps(
  db: D1Database,
  harborId: string,
  recipientDeviceId: string,
  sinceEpoch?: number,
): Promise<HarborKeyWrapRow[]> {
  const r =
    sinceEpoch === undefined
      ? await db
          .prepare(
            'SELECT * FROM harbor_key_wraps WHERE harbor_id = ? AND recipient_device_id = ? ORDER BY authority_epoch ASC',
          )
          .bind(harborId, recipientDeviceId)
          .all<HarborKeyWrapRow>()
      : await db
          .prepare(
            'SELECT * FROM harbor_key_wraps WHERE harbor_id = ? AND recipient_device_id = ? AND authority_epoch >= ? ORDER BY authority_epoch ASC',
          )
          .bind(harborId, recipientDeviceId, sinceEpoch)
          .all<HarborKeyWrapRow>();
  return r.results ?? [];
}

// ── Harbor invites (single-use JTI + /join; migrations/2026-08-23) ────────────
//
// An invite row stores ONLY the SHA-256 hash of its bearer token (user_tokens
// discipline) and never any key material. Single-use is enforced by
// compare-and-swap on consumed_at IS NULL — never read-then-write.

export interface HarborInviteRow {
  jti: string;
  harbor_id: string;
  token_hash: string;
  invited_by: string;
  role: HarborRole; // CHECK-pinned to 'member' in v1 (invariant I4)
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  consumed_by: string | null;
  revoked_at: number | null;
  revoked_by: string | null;
}

export interface HarborInviteListRow {
  jti: string;
  invited_by: string;
  /** GitHub login of the inviter (joined); null for erased accounts. */
  inviter_login: string | null;
  role: HarborRole;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  revoked_at: number | null;
}

export async function createHarborInvite(
  db: D1Database,
  i: { jti: string; harborId: string; tokenHash: string; invitedBy: string; createdAt: number; expiresAt: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO harbor_invites (jti, harbor_id, token_hash, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, ?, 'member', ?, ?)",
    )
    .bind(i.jti, i.harborId, i.tokenHash, i.invitedBy, i.createdAt, i.expiresAt)
    .run();
}

/** Invite by presented-token hash, scoped to the harbor in the URL. */
export async function getHarborInviteByTokenHash(
  db: D1Database,
  harborId: string,
  tokenHash: string,
): Promise<HarborInviteRow | null> {
  const row = await db
    .prepare('SELECT * FROM harbor_invites WHERE harbor_id = ? AND token_hash = ?')
    .bind(harborId, tokenHash)
    .first<HarborInviteRow>();
  return row ?? null;
}

/** Invite by its JTI handle, scoped to the harbor in the URL. */
export async function getHarborInviteByJti(
  db: D1Database,
  harborId: string,
  jti: string,
): Promise<HarborInviteRow | null> {
  const row = await db
    .prepare('SELECT * FROM harbor_invites WHERE harbor_id = ? AND jti = ?')
    .bind(harborId, jti)
    .first<HarborInviteRow>();
  return row ?? null;
}

/** Every invite of a harbor, newest first, inviter logins joined in. Never token hashes. */
export async function listHarborInvites(db: D1Database, harborId: string): Promise<HarborInviteListRow[]> {
  const r = await db
    .prepare(
      `SELECT i.jti, i.invited_by, u.login AS inviter_login, i.role, i.created_at, i.expires_at, i.consumed_at, i.revoked_at
       FROM harbor_invites i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.harbor_id = ?
       ORDER BY i.created_at DESC, i.jti ASC`,
    )
    .bind(harborId)
    .all<HarborInviteListRow>();
  return r.results ?? [];
}

/**
 * Single-use consume: the compare-and-swap. One UPDATE whose WHERE clause is
 * the entire validity check — unconsumed, unrevoked, unexpired, bound to THIS
 * harbor. Under any interleaving exactly one caller sees changes=1; there is
 * no read-then-write window. Returns whether THIS caller won the consume.
 */
export async function consumeHarborInvite(
  db: D1Database,
  c: { harborId: string; tokenHash: string; userId: string; now: number },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE harbor_invites SET consumed_at = ?, consumed_by = ?
       WHERE harbor_id = ? AND token_hash = ?
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(c.now, c.userId, c.harborId, c.tokenHash, c.now)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/**
 * Revoke an invite (invariant I3): CAS on the same live predicate as consume,
 * so revoke and consume race to the row and exactly one wins. A consumed
 * invite cannot be revoked (the membership already exists — remove the member
 * instead); an already-revoked one is a no-op. Returns whether THIS call
 * performed the revocation.
 */
export async function revokeHarborInvite(
  db: D1Database,
  v: { harborId: string; jti: string; revokedBy: string; now: number },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE harbor_invites SET revoked_at = ?, revoked_by = ?
       WHERE harbor_id = ? AND jti = ?
         AND consumed_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(v.now, v.revokedBy, v.harborId, v.jti)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// ── Helm (grand-plan X3 v1: explicit authority record per harbor) ─────────────
//
// One row per harbor: holder + ORDERED succession list. NO voting machinery
// (D6). The helm changes only via an owner's PUT (setHelm) or the dead-man
// rule (applyHelmTransition, CAS-guarded by seq). Every change also appends a
// helm_events audit row — a helm never changes silently.

export interface HelmPrincipal {
  kind: HarborMemberKind;
  id: string;
  /** Display label captured at set time (login / fingerprint). */
  label: string;
}

export interface HelmRow {
  harbor_id: string;
  holder_kind: HarborMemberKind | null;
  holder_id: string | null;
  holder_label: string | null;
  succession_json: string; // ordered JSON array of HelmPrincipal
  state: 'held' | 'vacant';
  vacant_flagged: number;
  seq: number;
  updated_at: number;
  updated_by: string; // users.id (owner PUT) or 'relay:dead-man'
  /**
   * What a parley DEADLINE LAPSE does in this harbor (mediator-body):
   * 'lapse' = v1 plain lapse; 'first-proceeds' = the Helm's default outcome
   * (first claimant proceeds, second rebases) is applied and recorded.
   */
  parley_expiry_default: ParleyExpiryDefault;
}

/** The Helm's configured parley-expiry behavior. */
export type ParleyExpiryDefault = 'lapse' | 'first-proceeds';

export type HelmEventKind = 'helm_set' | 'dead_man_pass' | 'dead_man_vacant';

export interface HelmEventRow {
  id: string;
  harbor_id: string;
  at: number;
  kind: HelmEventKind;
  detail: string; // JSON
}

export async function getHelm(db: D1Database, harborId: string): Promise<HelmRow | null> {
  const row = await db
    .prepare('SELECT * FROM harbor_helms WHERE harbor_id = ?')
    .bind(harborId)
    .first<HelmRow>();
  return row ?? null;
}

/** Owner PUT: upsert the authority record (state resets to held/unflagged). */
export async function setHelm(
  db: D1Database,
  h: {
    harborId: string;
    holder: HelmPrincipal;
    successionJson: string;
    seq: number;
    updatedAt: number;
    updatedBy: string;
    /** Parley-expiry behavior for this harbor; defaults to v1's plain 'lapse'. */
    parleyExpiryDefault?: ParleyExpiryDefault;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO harbor_helms
         (harbor_id, holder_kind, holder_id, holder_label, succession_json, state, vacant_flagged, seq, updated_at, updated_by, parley_expiry_default)
       VALUES (?, ?, ?, ?, ?, 'held', 0, ?, ?, ?, ?)
       ON CONFLICT(harbor_id) DO UPDATE SET
         holder_kind = excluded.holder_kind,
         holder_id = excluded.holder_id,
         holder_label = excluded.holder_label,
         succession_json = excluded.succession_json,
         state = 'held',
         vacant_flagged = 0,
         seq = excluded.seq,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by,
         parley_expiry_default = excluded.parley_expiry_default`,
    )
    .bind(
      h.harborId,
      h.holder.kind,
      h.holder.id,
      h.holder.label,
      h.successionJson,
      h.seq,
      h.updatedAt,
      h.updatedBy,
      h.parleyExpiryDefault ?? 'lapse',
    )
    .run();
}

/**
 * Dead-man transition, CAS-guarded on seq: returns true iff THIS caller won
 * the transition (two concurrent reads race; exactly one UPDATE matches).
 * The winner then appends the helm_events audit row.
 */
export async function applyHelmTransition(
  db: D1Database,
  t: {
    harborId: string;
    expectedSeq: number;
    holder: HelmPrincipal | null; // null ⇒ vacant
    successionJson: string;
    vacantFlagged: boolean;
    updatedAt: number;
  },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE harbor_helms SET
         holder_kind = ?, holder_id = ?, holder_label = ?,
         succession_json = ?, state = ?, vacant_flagged = ?,
         seq = seq + 1, updated_at = ?, updated_by = 'relay:dead-man'
       WHERE harbor_id = ? AND seq = ?`,
    )
    .bind(
      t.holder?.kind ?? null,
      t.holder?.id ?? null,
      t.holder?.label ?? null,
      t.successionJson,
      t.holder ? 'held' : 'vacant',
      t.vacantFlagged ? 1 : 0,
      t.updatedAt,
      t.harborId,
      t.expectedSeq,
    )
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function insertHelmEvent(
  db: D1Database,
  e: { harborId: string; at: number; kind: HelmEventKind; detail: unknown },
): Promise<void> {
  await db
    .prepare('INSERT INTO helm_events (id, harbor_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(`he_${randomHex(8)}`, e.harborId, e.at, e.kind, JSON.stringify(e.detail))
    .run();
}

/** Recent helm audit rows, newest first (member-gated read). */
export async function listHelmEvents(
  db: D1Database,
  harborId: string,
  limit = 20,
): Promise<HelmEventRow[]> {
  const r = await db
    .prepare('SELECT id, harbor_id, at, kind, detail FROM helm_events WHERE harbor_id = ? ORDER BY at DESC, id DESC LIMIT ?')
    .bind(harborId, limit)
    .all<HelmEventRow>();
  return r.results ?? [];
}

/** Live (non-deleted) user by GitHub login, case-insensitive; or null. */
export async function getUserByLogin(db: D1Database, login: string): Promise<UserRow | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE login = ? COLLATE NOCASE AND deleted_at IS NULL')
    .bind(login)
    .first<UserRow>();
  return row ?? null;
}

// ── Parleys (grand-plan X4 v1: signed multi-party agreements) ─────────────────
//
// A parley is an artifact: harbor + subject + proposer + deadline + a
// three-state machine (open → agreed | lapsed). parley_positions holds one row
// per participant identity; is_party=1 rows are NAMED parties whose signed
// 'accept' is required for agreement, is_party=0 rows are reserved observers
// (v1: the tier-labeled 'pd-mediator' seat, no auto-behavior). Signatures are
// write-once (signParleyPosition CAS on signed_at IS NULL) and no route writes
// to a non-open parley (resolveParleyState CAS on state='open').

export type ParleyState = 'open' | 'agreed' | 'lapsed';
export type ParleyPartyKind = 'user' | 'daemon' | 'mediator';
export type ParleyStance = 'accept' | 'reject';

export interface ParleyRow {
  id: string;
  harbor_id: string;
  subject: string;
  proposer_id: string;
  proposer_label: string;
  state: ParleyState;
  deadline_at: number;
  created_at: number;
  resolved_at: number | null;
  /** 'mediator' when auto-convened on a predicted PR conflict (mediator-body). */
  convened_by: 'user' | 'mediator';
  /** JSON outcome the Helm's expiry default recorded on lapse; NULL otherwise. */
  outcome_json: string | null;
}

export interface ParleyPositionRow {
  parley_id: string;
  party_kind: ParleyPartyKind;
  party_id: string;
  party_label: string;
  tier: string;
  is_party: number;
  stance: ParleyStance | null;
  position: string | null;
  signed_at: number | null;
  /** Claimant order on mediator pairs (1 = first claimant); NULL on v1 parleys. */
  claim_rank: number | null;
}

export interface ParleyPartySeed {
  kind: ParleyPartyKind;
  id: string;
  label: string;
  tier: string;
  isParty: boolean;
  /**
   * Claimant order on a mediator-convened pair (1 = first claimant, 2 =
   * second). Omitted/undefined on every human-convened parley — the Helm's
   * expiry default applies only where ranks exist, so v1 parleys are
   * structurally unaffected by it.
   */
  claimRank?: number;
}

/**
 * Create a parley plus ALL its position seats atomically (D1 batch — a parley
 * whose named parties never landed could silently agree with nobody, so the
 * rows must land together).
 */
export async function createParley(
  db: D1Database,
  p: {
    id: string;
    harborId: string;
    subject: string;
    proposerId: string;
    proposerLabel: string;
    deadlineAt: number;
    createdAt: number;
    parties: ParleyPartySeed[];
    /** 'mediator' when auto-convened on a predicted conflict; default 'user'. */
    convenedBy?: 'user' | 'mediator';
  },
): Promise<void> {
  const stmts = [
    db.prepare(
      `INSERT INTO parleys (id, harbor_id, subject, proposer_id, proposer_label, state, deadline_at, created_at, resolved_at, convened_by)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?)`,
    ).bind(p.id, p.harborId, p.subject, p.proposerId, p.proposerLabel, p.deadlineAt, p.createdAt, p.convenedBy ?? 'user'),
    ...p.parties.map((party) =>
      db.prepare(
        `INSERT INTO parley_positions (parley_id, party_kind, party_id, party_label, tier, is_party, stance, position, signed_at, claim_rank)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      ).bind(p.id, party.kind, party.id, party.label, party.tier, party.isParty ? 1 : 0, party.claimRank ?? null),
    ),
  ];
  await db.batch(stmts);
}

export async function getParley(db: D1Database, parleyId: string): Promise<ParleyRow | null> {
  const row = await db
    .prepare('SELECT * FROM parleys WHERE id = ?')
    .bind(parleyId)
    .first<ParleyRow>();
  return row ?? null;
}

/** Parleys of a harbor, newest first (member-gated read). */
export async function listParleys(db: D1Database, harborId: string, limit = 50): Promise<ParleyRow[]> {
  const r = await db
    .prepare('SELECT * FROM parleys WHERE harbor_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(harborId, limit)
    .all<ParleyRow>();
  return r.results ?? [];
}

/** All seats of a parley: named parties first, then observers, stable order. */
export async function listParleyPositions(db: D1Database, parleyId: string): Promise<ParleyPositionRow[]> {
  const r = await db
    .prepare(
      'SELECT * FROM parley_positions WHERE parley_id = ? ORDER BY is_party DESC, party_kind ASC, party_id ASC',
    )
    .bind(parleyId)
    .all<ParleyPositionRow>();
  return r.results ?? [];
}

/**
 * Sign a named party's position — write-once, CAS on signed_at IS NULL AND
 * is_party = 1. Returns true iff THIS call recorded the signature (false:
 * already signed, or not a named-party seat).
 */
export async function signParleyPosition(
  db: D1Database,
  s: {
    parleyId: string;
    kind: ParleyPartyKind;
    partyId: string;
    stance: ParleyStance;
    position: string | null;
    signedAt: number;
  },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE parley_positions SET stance = ?, position = ?, signed_at = ?
       WHERE parley_id = ? AND party_kind = ? AND party_id = ?
         AND is_party = 1 AND signed_at IS NULL`,
    )
    .bind(s.stance, s.position, s.signedAt, s.parleyId, s.kind, s.partyId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Named parties who have NOT signed 'accept' yet (0 ⇒ agreement reached). */
export async function countUnacceptedParties(db: D1Database, parleyId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM parley_positions
       WHERE parley_id = ? AND is_party = 1 AND (stance IS NULL OR stance != 'accept')`,
    )
    .bind(parleyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * open → agreed | lapsed, CAS-guarded on state='open' so a non-open parley is
 * immutable and concurrent resolvers elect exactly one winner. Returns true
 * iff THIS caller performed the transition.
 */
export async function resolveParleyState(
  db: D1Database,
  t: { parleyId: string; state: 'agreed' | 'lapsed'; at: number },
): Promise<boolean> {
  const r = await db
    .prepare("UPDATE parleys SET state = ?, resolved_at = ? WHERE id = ? AND state = 'open'")
    .bind(t.state, t.at, t.parleyId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Signature tally for one parley: how many named parties, how many signed. */
export interface ParleySignatureTally {
  parley_id: string;
  parties: number;
  signed: number;
}

/**
 * Tally signatures across MANY parleys in a single query.
 *
 * Motivation: the rendered parley list wants "2 of 3 signed" on every row, and
 * the obvious implementation — listParleyPositions per parley — is an N+1 that
 * turns a 25-row page into 26 D1 round trips. On a Worker that is the
 * difference between a page that feels instant and one that visibly hitches,
 * and it scales with exactly the thing (a busy harbor) that makes the page
 * worth loading. One GROUP BY over a bounded id list costs one round trip
 * regardless of row count.
 *
 * `is_party = 1` in the WHERE clause is load-bearing, not an optimization: the
 * denominator here must be the count of parties whose accept agreement
 * actually requires. Counting observer seats — the pd-mediator row — would
 * render "2 of 4 signed" on a parley that is one signature from agreed, which
 * would be a lie about the state machine drawn from the same table the state
 * machine reads.
 *
 * @param db D1 handle.
 * @param parleyIds Parleys to tally; an empty array short-circuits with no query.
 * @returns One tally per parley that has at least one named party, unordered.
 */
export async function tallyParleySignatures(
  db: D1Database,
  parleyIds: string[],
): Promise<ParleySignatureTally[]> {
  if (parleyIds.length === 0) return [];
  const holes = parleyIds.map(() => '?').join(',');
  const r = await db
    .prepare(
      `SELECT parley_id,
              COUNT(*) AS parties,
              SUM(CASE WHEN signed_at IS NOT NULL THEN 1 ELSE 0 END) AS signed
       FROM parley_positions
       WHERE is_party = 1 AND parley_id IN (${holes})
       GROUP BY parley_id`,
    )
    .bind(...parleyIds)
    .all<ParleySignatureTally>();
  return r.results ?? [];
}

/**
 * Record the pd-mediator's observation note on ITS OWN observer row.
 *
 * This is the mediator's ONLY write in the entire codebase (src/mediator.ts),
 * and it is deliberately shaped so that the mediator's guarantees are
 * properties of the SQL rather than promises in a comment. Two halves matter:
 *
 * The SET list names `position` and nothing else. `stance` and `signed_at` are
 * not mentioned, so no argument to this function — however hostile, however
 * mangled a model's output — can make the mediator appear to have signed. Its
 * `signed_at` stays NULL forever, and a NULL `signed_at` is exactly what every
 * read path (and the rendered surfaces) use to mean "has not signed".
 *
 * The WHERE clause pins `party_kind = 'mediator' AND party_id = MEDIATOR_ID AND
 * is_party = 0`. A human's or daemon's row can never match, so this write
 * cannot alter another party's recorded position; and because `is_party = 0`
 * rows are invisible to `countUnacceptedParties`, writing here can neither
 * cause nor block agreement. The `signed_at IS NULL` conjunct is defence in
 * depth: it makes the statement a no-op against any row that somehow does
 * carry a signature, so a corrupted seat degrades to silence rather than to a
 * rewritten signature.
 *
 * Note also what is absent: this function never touches the `parleys` table,
 * so a deadline, a state, and a resolution timestamp are all unreachable from
 * the mediator's code path. Its capability is exactly "annotate my own row".
 *
 * Overwriting a previous note is intended — the observation tracks the record
 * as it currently stands, and a parley that has gained two more signatures
 * deserves a current summary rather than a stale one. Signatures are
 * write-once; observations are not signatures, and conflating them would be
 * the lie this whole design avoids.
 *
 * @param db D1 handle.
 * @param o.parleyId The parley whose mediator seat is being annotated.
 * @param o.note Sanitized observation text (see sanitizeObservation).
 * @returns True iff a mediator observer row was actually annotated.
 */
export async function recordMediatorObservation(
  db: D1Database,
  o: { parleyId: string; note: string },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE parley_positions SET position = ?
       WHERE parley_id = ? AND party_kind = 'mediator' AND is_party = 0 AND signed_at IS NULL`,
    )
    .bind(o.note, o.parleyId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Lazy deadline sweep for one harbor: every expired open parley lapses. */
export async function lapseExpiredParleys(db: D1Database, harborId: string, now: number): Promise<void> {
  await db
    .prepare(
      "UPDATE parleys SET state = 'lapsed', resolved_at = ? WHERE harbor_id = ? AND state = 'open' AND deadline_at < ?",
    )
    .bind(now, harborId, now)
    .run();
}

// ── Mediator body (src/mediator-body.ts; grand-plan node mediator-body) ───────
//
// The prediction registry (one OPEN parley per PR pair), the
// delivery-acknowledged summons ledger, the human approve gate, and the
// Helm-default expiry outcome. Every state transition below is CAS-guarded on
// the current state, mirroring the parley state machine's own discipline.

export interface MediatorPairRow {
  repo: string;
  pr_lo: number;
  pr_hi: number;
  first_pr: number;
  parley_id: string;
  confidence: number;
  symbols_json: string;
  created_at: number;
}

export async function insertMediatorPair(db: D1Database, r: MediatorPairRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mediator_pairs (repo, pr_lo, pr_hi, first_pr, parley_id, confidence, symbols_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(r.repo, r.pr_lo, r.pr_hi, r.first_pr, r.parley_id, r.confidence, r.symbols_json, r.created_at)
    .run();
}

/**
 * The one-OPEN-parley-per-PR-pair invariant's lookup: the parley id of any
 * still-open mediator parley for this normalized pair, or null. The join to
 * parleys.state (rather than a flag on the pair row) means a parley that
 * agreed, lapsed, or expired frees the pair automatically — no second
 * bookkeeping write that could be forgotten.
 */
export async function findOpenParleyForPair(
  db: D1Database,
  repo: string,
  prLo: number,
  prHi: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT mp.parley_id AS parley_id FROM mediator_pairs mp
       JOIN parleys p ON p.id = mp.parley_id
       WHERE mp.repo = ? AND mp.pr_lo = ? AND mp.pr_hi = ? AND p.state = 'open'
       LIMIT 1`,
    )
    .bind(repo, prLo, prHi)
    .first<{ parley_id: string }>();
  return row?.parley_id ?? null;
}

/** The pair row behind one mediator-convened parley (page + expiry rendering). */
export async function getMediatorPairForParley(
  db: D1Database,
  parleyId: string,
): Promise<MediatorPairRow | null> {
  const row = await db
    .prepare('SELECT * FROM mediator_pairs WHERE parley_id = ? LIMIT 1')
    .bind(parleyId)
    .first<MediatorPairRow>();
  return row ?? null;
}

export type ParleySummonsState = 'summoned' | 'acked' | 'refused' | 'escalated';

export interface ParleySummonsRow {
  id: string;
  parley_id: string;
  party_kind: 'user' | 'daemon';
  party_id: string;
  party_label: string;
  daemon_fingerprint: string | null;
  summons_channel: string;
  summons_seq: number;
  summons_hash: string;
  issued_at: number;
  state: ParleySummonsState;
  response_channel: string | null;
  response_seq: number | null;
  response_hash: string | null;
  responded_at: number | null;
  escalated_at: number | null;
}

export async function insertParleySummons(db: D1Database, s: ParleySummonsRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO parley_summonses
         (id, parley_id, party_kind, party_id, party_label, daemon_fingerprint,
          summons_channel, summons_seq, summons_hash, issued_at, state,
          response_channel, response_seq, response_hash, responded_at, escalated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      s.id, s.parley_id, s.party_kind, s.party_id, s.party_label, s.daemon_fingerprint,
      s.summons_channel, s.summons_seq, s.summons_hash, s.issued_at, s.state,
      s.response_channel, s.response_seq, s.response_hash, s.responded_at, s.escalated_at,
    )
    .run();
}

export async function getParleySummons(db: D1Database, id: string): Promise<ParleySummonsRow | null> {
  const row = await db
    .prepare('SELECT * FROM parley_summonses WHERE id = ?')
    .bind(id)
    .first<ParleySummonsRow>();
  return row ?? null;
}

/** All summonses of one parley, stable order (issue time, then id). */
export async function listParleySummonses(db: D1Database, parleyId: string): Promise<ParleySummonsRow[]> {
  const r = await db
    .prepare('SELECT * FROM parley_summonses WHERE parley_id = ? ORDER BY issued_at ASC, id ASC')
    .bind(parleyId)
    .all<ParleySummonsRow>();
  return r.results ?? [];
}

/**
 * Record a daemon's chained response to a summons — CAS on state='summoned'
 * so a response is WRITE-ONCE: a second response (or a response racing the
 * first) changes nothing and returns false. `escalatedAt` is non-null exactly
 * when the response wakes the human (refuse/escalate, doctrine D11).
 */
export async function resolveParleySummons(
  db: D1Database,
  t: {
    id: string;
    state: 'acked' | 'refused' | 'escalated';
    responseChannel: string;
    responseSeq: number;
    responseHash: string;
    respondedAt: number;
    escalatedAt: number | null;
  },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE parley_summonses SET
         state = ?, response_channel = ?, response_seq = ?, response_hash = ?,
         responded_at = ?, escalated_at = ?
       WHERE id = ? AND state = 'summoned'`,
    )
    .bind(t.state, t.responseChannel, t.responseSeq, t.responseHash, t.respondedAt, t.escalatedAt, t.id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export type ParleyGateAction = 'merge' | 'revert' | 'force-push';
export type ParleyGateState = 'pending' | 'approved' | 'modified' | 'rejected';

/** The actions that count as irreversible (destructive-action policy). */
export const IRREVERSIBLE_ACTIONS: readonly ParleyGateAction[] = ['merge', 'revert', 'force-push'];

export interface ParleyGateRow {
  parley_id: string;
  action: ParleyGateAction;
  state: ParleyGateState;
  verdict_by: string | null;
  verdict_by_label: string | null;
  verdict_at: number | null;
  modify_text: string | null;
  created_at: number;
}

export async function insertParleyGate(
  db: D1Database,
  g: { parleyId: string; action: ParleyGateAction; createdAt: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO parley_gates (parley_id, action, state, verdict_by, verdict_by_label, verdict_at, modify_text, created_at)
       VALUES (?, ?, 'pending', NULL, NULL, NULL, NULL, ?)`,
    )
    .bind(g.parleyId, g.action, g.createdAt)
    .run();
}

export async function getParleyGate(db: D1Database, parleyId: string): Promise<ParleyGateRow | null> {
  const row = await db
    .prepare('SELECT * FROM parley_gates WHERE parley_id = ?')
    .bind(parleyId)
    .first<ParleyGateRow>();
  return row ?? null;
}

/**
 * Record a human verdict — CAS on state='pending' so a verdict is WRITE-ONCE
 * (the same discipline as a signed position: a decided gate is immutable).
 * Returns false when a concurrent verdict won, or the gate was never pending.
 */
export async function resolveParleyGateState(
  db: D1Database,
  t: {
    parleyId: string;
    state: 'approved' | 'modified' | 'rejected';
    verdictBy: string;
    verdictByLabel: string;
    verdictAt: number;
    modifyText: string | null;
  },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE parley_gates SET state = ?, verdict_by = ?, verdict_by_label = ?, verdict_at = ?, modify_text = ?
       WHERE parley_id = ? AND state = 'pending'`,
    )
    .bind(t.state, t.verdictBy, t.verdictByLabel, t.verdictAt, t.modifyText, t.parleyId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/**
 * Lapse one expired parley RECORDING an outcome — the Helm-default variant of
 * resolveParleyState. Same CAS on state='open': whichever caller (or plain
 * lapse) wins, the parley lapses exactly once and the outcome is never
 * overwritten onto an already-resolved artifact.
 */
export async function lapseParleyWithOutcome(
  db: D1Database,
  t: { parleyId: string; at: number; outcomeJson: string },
): Promise<boolean> {
  const r = await db
    .prepare(
      "UPDATE parleys SET state = 'lapsed', resolved_at = ?, outcome_json = ? WHERE id = ? AND state = 'open'",
    )
    .bind(t.at, t.outcomeJson, t.parleyId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Expired-but-still-open parleys of one harbor (per-parley expiry pass). */
export async function listExpiredOpenParleys(
  db: D1Database,
  harborId: string,
  now: number,
): Promise<ParleyRow[]> {
  const r = await db
    .prepare("SELECT * FROM parleys WHERE harbor_id = ? AND state = 'open' AND deadline_at < ?")
    .bind(harborId, now)
    .all<ParleyRow>();
  return r.results ?? [];
}

// ── Mediator kill flag (KV-backed, N6 machinery) ─────────────────────────────

/**
 * KV key holding the `kill-mediator` flag. Shared with the executor's scan
 * gate the same way FLEET_PAUSED_KEY is: one control-plane KV namespace, one
 * honest truth. When set, the mediator is FULLY INERT on both workers —
 * no prediction, no convening, no summons responses, no gate verdicts.
 */
export const KILL_MEDIATOR_KEY = 'fleet:kill-mediator';

/** Read the kill-mediator flag (same tolerant shapes as getFleetPaused). */
export async function getMediatorKilled(kv: KVNamespace): Promise<boolean> {
  const raw = await kv.get(KILL_MEDIATOR_KEY);
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  try {
    const parsed = JSON.parse(raw) as { killed?: boolean };
    return parsed.killed === true;
  } catch {
    return false;
  }
}

/** Write the kill-mediator flag as structured JSON, stamping killedAt. */
export async function setMediatorKilled(
  kv: KVNamespace,
  killed: boolean,
): Promise<{ killed: boolean; killedAt: number }> {
  const state = { killed, killedAt: Math.floor(Date.now() / 1000) };
  await kv.put(KILL_MEDIATOR_KEY, JSON.stringify(state));
  return state;
}

// ── Modify re-injection handoff (control-plane KV) ───────────────────────────

/**
 * KV key carrying a gate's Modify free text to the losing agent's next
 * re-execution. Written by the relay when a human renders 'Modify'; peeked by
 * the executor and acknowledged after terminal success with a durable,
 * per-parley acknowledgement key. The pointer is not deleted, so acknowledging
 * an older order cannot erase a newer one that raced onto the same PR.
 * The control-plane KV is already the one namespace both workers share
 * (fleet:paused rides it), so no new auth surface is invented for this.
 */
export function mediatorReinjectionKey(repo: string, pr: number): string {
  return `mediator:reinjection:${repo}:${pr}`;
}

export interface MediatorReinjection {
  parleyId: string;
  repo: string;
  pr: number;
  action: ParleyGateAction;
  modifyText: string;
  decidedBy: string;
  at: number;
}

export async function putMediatorReinjection(kv: KVNamespace, r: MediatorReinjection): Promise<void> {
  await kv.put(mediatorReinjectionKey(r.repo, r.pr), JSON.stringify(r));
}

// ── Shipwright chat (src/shipwright.ts) ───────────────────────────────────────

export interface ShipwrightMessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

/** Append one chat message for a user. `now` is injected (testable clock). */
export async function insertShipwrightMessage(
  db: D1Database,
  row: { userId: string; role: 'user' | 'assistant'; content: string; now: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO shipwright_chats (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .bind(row.userId, row.role, row.content, row.now)
    .run();
}

/**
 * The most recent `limit` messages for ONE user, in conversation order
 * (oldest → newest). Scoping is the WHERE user_id — a session can never read
 * another account's conversation. Ordered by the AUTOINCREMENT id, not
 * created_at: two messages routinely share a unix second.
 */
export async function listShipwrightMessages(
  db: D1Database,
  userId: string,
  limit = 60,
): Promise<ShipwrightMessageRow[]> {
  const rows = await db
    .prepare(
      'SELECT id, role, content, created_at FROM shipwright_chats WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    )
    .bind(userId, limit)
    .all<ShipwrightMessageRow>();
  return (rows.results ?? []).reverse();
}

/** Delete a user's whole conversation (their own clear control). */
export async function clearShipwrightChats(db: D1Database, userId: string): Promise<number> {
  const res = await db.prepare('DELETE FROM shipwright_chats WHERE user_id = ?').bind(userId).run();
  return res.meta?.changes ?? 0;
}
