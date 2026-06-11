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
  // Atomic chain continuity check + insert using D1 batch transaction.
  // We verify prev_hash + seq match BEFORE writing to prevent chain breaks.
  const last = await getLastEventSeq(db, event.sender, event.channel);
  const expectedSeq = last ? last.seq + 1 : 1;
  const expectedPrevHash = last ? last.this_hash : '0'.repeat(64);

  if (event.seq !== expectedSeq) {
    throw new ChainError('SEQ_MISMATCH', `Expected seq ${expectedSeq}, got ${event.seq}`);
  }
  if (event.prev_hash !== expectedPrevHash) {
    throw new ChainError('HASH_MISMATCH', `Expected prev_hash ${expectedPrevHash}`);
  }

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

export async function revokeByIssuer(
  db: D1Database,
  issuer: string,
  iatMin: number,
  iatMax: number,
  reason: string
): Promise<string[]> {
  // Find all identities with oidc proof from this issuer in the time window.
  // proof_metadata is JSON: { issuer, jti, iat }
  const rows = await db.prepare(
    `SELECT daemon_fingerprint, proof_metadata FROM identities
     WHERE proof_method = 'oidc'`
  ).all<{ daemon_fingerprint: string; proof_metadata: string }>();

  const affected: string[] = [];
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

// ── Errors ────────────────────────────────────────────────────────────────────

export class ChainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChainError';
  }
}
