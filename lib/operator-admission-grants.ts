/**
 * Exact operator admission grants.
 *
 * A grant is a non-secret, one-shot daemon record that lets one uncredentialed
 * `pd begin` mint one ordinary actor after ordinary newcomer admission is no
 * longer available. It never changes the newcomer pool. Authority is narrow:
 * identity + canonical linked worktree + branch + normalized remote + exact
 * head/base + roadmap + short expiry. The daemon probes Git at issue and again
 * immediately before the transactional consume.
 */

import type { Database } from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWorktreeInfo } from './worktree.js';

const DEFAULT_TTL_MS = 5 * 60_000;
const MIN_TTL_MS = 10_000;
const MAX_TTL_MS = 15 * 60_000;

export type OperatorAdmissionGrantStatus = 'active' | 'consumed' | 'expired';
export type OperatorAdmissionReceiptKind = 'issued' | 'consumed' | 'expired' | 'rejected';

export interface OperatorAdmissionWorktreeProbe {
  root: string;
  branch: string | null;
  remote: string;
  head: string;
  base: string;
  clean: boolean;
  linked: boolean;
}

export interface OperatorAdmissionGrant {
  grantId: string;
  bindingHash: string;
  identity: string;
  worktreeRoot: string;
  branch: string;
  remote: string;
  head: string;
  base: string;
  roadmapSlug: string;
  operatorIdentity: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  consumedActorId: string | null;
  status: OperatorAdmissionGrantStatus;
}

export interface OperatorAdmissionReceipt {
  receiptId: string;
  grantId: string;
  kind: OperatorAdmissionReceiptKind;
  at: number;
  details: Record<string, unknown>;
}

export interface IssueOperatorAdmissionGrantInput {
  identity: string;
  worktreeRoot: string;
  roadmapSlug: string;
  operatorIdentity: string;
  ttlMs?: number;
}

export interface ConsumeOperatorAdmissionGrantInput {
  grantId: string;
  identity: string;
  worktreeRoot: string;
  roadmapSlug: string;
}

export type OperatorAdmissionFailureCode =
  | 'GRANT_NOT_FOUND'
  | 'GRANT_ALREADY_CONSUMED'
  | 'GRANT_EXPIRED'
  | 'GRANT_BINDING_MISMATCH'
  | 'GRANT_CONFLICT'
  | 'GRANT_ENACTMENT_REJECTED'
  | 'WORKTREE_PROVENANCE_INVALID'
  | 'VALIDATION_ERROR'
  | 'STORE_UNAVAILABLE';

interface GrantRow {
  grant_id: string;
  binding_hash: string;
  identity: string;
  worktree_root: string;
  branch: string;
  remote: string;
  head_sha: string;
  base_sha: string;
  roadmap_slug: string;
  operator_identity: string;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
  consumed_actor_id: string | null;
  state: OperatorAdmissionGrantStatus;
}

interface ReceiptRow {
  receipt_id: string;
  grant_id: string;
  kind: OperatorAdmissionReceiptKind;
  at: number;
  details_json: string;
}

interface OperatorAdmissionGrantDeps {
  now?: () => number;
  probeWorktree?: (root: string) => OperatorAdmissionWorktreeProbe;
}

class OperatorAdmissionEnactmentRollback<T> extends Error {
  constructor(readonly enactment: T, message: string) {
    super(message);
    this.name = 'OperatorAdmissionEnactmentRollback';
  }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Canonical comparison form; never used as a fetch URL. */
export function normalizeAdmissionRemote(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!value) throw new Error('origin remote is empty');

  const scp = value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scp && !value.includes('://') && !value.startsWith('/')) {
    return `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+/, '')}`;
  }

  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return `file:${resolve(decodeURIComponent(url.pathname))}`;
    return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+/, '')}`;
  } catch {
    if (value.startsWith('/') || value.startsWith('.')) return `file:${resolve(value)}`;
    throw new Error('origin remote is not a supported Git URL or path');
  }
}

function defaultProbeWorktree(requestedRoot: string): OperatorAdmissionWorktreeProbe {
  const root = realpathSync(resolve(requestedRoot));
  const info = getWorktreeInfo(root);
  if (!info || realpathSync(info.root) !== root) {
    throw new Error('path is not the root of a Git worktree');
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  const branch = info.branch;
  const remote = normalizeAdmissionRemote(git(root, ['remote', 'get-url', 'origin']));

  let baseRef: string | null = null;
  try {
    baseRef = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  } catch {
    for (const candidate of ['origin/main', 'origin/master']) {
      try {
        git(root, ['rev-parse', '--verify', candidate]);
        baseRef = candidate;
        break;
      } catch {
        // Try the next canonical base candidate.
      }
    }
  }
  const base = baseRef ? git(root, ['merge-base', 'HEAD', baseRef]) : head;
  const clean = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']) === '';
  return {
    root,
    branch,
    remote,
    head,
    base,
    clean,
    linked: !info.isMain,
  };
}

function bindingHash(binding: Omit<OperatorAdmissionWorktreeProbe, 'clean' | 'linked'> & {
  identity: string;
  roadmapSlug: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    binding.identity,
    binding.root,
    binding.branch,
    binding.remote,
    binding.head,
    binding.base,
    binding.roadmapSlug,
  ])).digest('hex');
}

function rowToGrant(row: GrantRow): OperatorAdmissionGrant {
  return {
    grantId: row.grant_id,
    bindingHash: row.binding_hash,
    identity: row.identity,
    worktreeRoot: row.worktree_root,
    branch: row.branch,
    remote: row.remote,
    head: row.head_sha,
    base: row.base_sha,
    roadmapSlug: row.roadmap_slug,
    operatorIdentity: row.operator_identity,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    consumedActorId: row.consumed_actor_id,
    status: row.state,
  };
}

function rowToReceipt(row: ReceiptRow): OperatorAdmissionReceipt {
  let details: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.details_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed;
  } catch {
    details = { parseError: true };
  }
  return {
    receiptId: row.receipt_id,
    grantId: row.grant_id,
    kind: row.kind,
    at: row.at,
    details,
  };
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > 512 || trimmed.includes('\0')) throw new Error(`${field} is invalid`);
  return trimmed;
}

function validateProbe(probe: OperatorAdmissionWorktreeProbe): string | null {
  if (!probe.linked) return 'worktree must be a linked worktree, never the main checkout';
  if (!probe.branch) return 'worktree must have an attached branch';
  if (!probe.clean) return 'worktree must be clean';
  if (
    typeof probe.remote !== 'string'
    || (!/^file:\/.+/.test(probe.remote) && !/^[a-z0-9.-]+\/.+/i.test(probe.remote))
  ) {
    return 'worktree origin remote must be present and normalized';
  }
  if (!/^[0-9a-f]{40,64}$/i.test(probe.head) || !/^[0-9a-f]{40,64}$/i.test(probe.base)) {
    return 'worktree head/base must be exact commit ids';
  }
  return null;
}

export function createOperatorAdmissionGrants(db: Database, deps: OperatorAdmissionGrantDeps = {}) {
  const now = deps.now ?? Date.now;
  const probeWorktree = deps.probeWorktree ?? defaultProbeWorktree;

  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_admission_grants (
      grant_id TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL,
      identity TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      branch TEXT NOT NULL,
      remote TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      roadmap_slug TEXT NOT NULL,
      operator_identity TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      consumed_actor_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('active', 'consumed', 'expired'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_admission_active_target
      ON operator_admission_grants(identity, worktree_root)
      WHERE state = 'active';
    CREATE TABLE IF NOT EXISTS operator_admission_grant_receipts (
      receipt_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('issued', 'consumed', 'expired', 'rejected')),
      at INTEGER NOT NULL,
      details_json TEXT NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES operator_admission_grants(grant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_operator_admission_receipts_grant
      ON operator_admission_grant_receipts(grant_id, at, receipt_id);
  `);

  const selectGrant = db.prepare(`SELECT * FROM operator_admission_grants WHERE grant_id = ?`);
  const selectActiveTarget = db.prepare(`
    SELECT * FROM operator_admission_grants
    WHERE identity = ? AND worktree_root = ? AND state = 'active'
  `);
  const selectAll = db.prepare(`SELECT * FROM operator_admission_grants ORDER BY issued_at DESC, grant_id DESC`);
  const selectReceipts = db.prepare(`
    SELECT * FROM operator_admission_grant_receipts
    WHERE grant_id = ? ORDER BY at ASC, rowid ASC
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO operator_admission_grant_receipts (receipt_id, grant_id, kind, at, details_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  function receipt(grantId: string, kind: OperatorAdmissionReceiptKind, at: number, details: Record<string, unknown>): OperatorAdmissionReceipt {
    const value: OperatorAdmissionReceipt = {
      receiptId: `oar_${randomUUID()}`,
      grantId,
      kind,
      at,
      details,
    };
    insertReceipt.run(value.receiptId, grantId, kind, at, JSON.stringify(details));
    return value;
  }

  const expireDueTx = db.transaction((at: number) => {
    const rows = db.prepare(`
      SELECT * FROM operator_admission_grants
      WHERE state = 'active' AND expires_at <= ?
    `).all(at) as GrantRow[];
    const update = db.prepare(`UPDATE operator_admission_grants SET state = 'expired' WHERE grant_id = ? AND state = 'active'`);
    for (const row of rows) {
      if (update.run(row.grant_id).changes === 1) {
        receipt(row.grant_id, 'expired', at, { expiresAt: row.expires_at });
      }
    }
  });

  function expireDue(at = now()): void {
    expireDueTx.immediate(at);
  }

  function issue(input: IssueOperatorAdmissionGrantInput):
    | { success: true; grant: OperatorAdmissionGrant; receipt: OperatorAdmissionReceipt; idempotent: boolean }
    | { success: false; code: OperatorAdmissionFailureCode; error: string } {
    let identity: string;
    let requestedRoot: string;
    let roadmapSlug: string;
    let operatorIdentity: string;
    let probe: OperatorAdmissionWorktreeProbe;
    try {
      identity = validateText(input.identity, 'identity');
      requestedRoot = validateText(input.worktreeRoot, 'worktreeRoot');
      roadmapSlug = validateText(input.roadmapSlug, 'roadmapSlug');
      operatorIdentity = validateText(input.operatorIdentity, 'operatorIdentity');
      probe = probeWorktree(requestedRoot);
    } catch (error) {
      return { success: false, code: 'WORKTREE_PROVENANCE_INVALID', error: (error as Error).message };
    }
    const invalid = validateProbe(probe);
    if (invalid) return { success: false, code: 'WORKTREE_PROVENANCE_INVALID', error: invalid };
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      return { success: false, code: 'VALIDATION_ERROR', error: `ttlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}` };
    }

    const hash = bindingHash({ ...probe, identity, roadmapSlug });
    const at = now();
    try {
      expireDue(at);
      return db.transaction(() => {
        const existing = selectActiveTarget.get(identity, probe.root) as GrantRow | undefined;
        if (existing) {
          if (existing.binding_hash === hash && existing.roadmap_slug === roadmapSlug) {
            const receipts = selectReceipts.all(existing.grant_id) as ReceiptRow[];
            return {
              success: true as const,
              grant: rowToGrant(existing),
              receipt: receipts.length > 0 ? rowToReceipt(receipts[0]) : receipt(existing.grant_id, 'issued', existing.issued_at, { bindingHash: hash }),
              idempotent: true,
            };
          }
          return {
            success: false as const,
            code: 'GRANT_CONFLICT' as const,
            error: 'an active grant already owns this identity and worktree with a different exact binding',
          };
        }
        const grantId = `oadm_${randomUUID()}`;
        const expiresAt = at + Math.floor(ttlMs);
        db.prepare(`
          INSERT INTO operator_admission_grants (
            grant_id, binding_hash, identity, worktree_root, branch, remote,
            head_sha, base_sha, roadmap_slug, operator_identity,
            issued_at, expires_at, state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(
          grantId, hash, identity, probe.root, probe.branch, probe.remote,
          probe.head, probe.base, roadmapSlug, operatorIdentity, at, expiresAt,
        );
        const issuedReceipt = receipt(grantId, 'issued', at, {
          bindingHash: hash,
          operatorIdentity,
          expiresAt,
          transport: 'owner-unix-socket',
        });
        return {
          success: true as const,
          grant: rowToGrant(selectGrant.get(grantId) as GrantRow),
          receipt: issuedReceipt,
          idempotent: false,
        };
      }).immediate();
    } catch (error) {
      return { success: false, code: 'STORE_UNAVAILABLE', error: (error as Error).message };
    }
  }

  function rejection(grantId: string, code: OperatorAdmissionFailureCode, error: string) {
    const at = now();
    try {
      receipt(grantId, 'rejected', at, { code, reason: error });
    } catch {
      // The primary failure remains authoritative even if receipt persistence
      // itself is unavailable; callers still fail closed.
    }
    return { success: false as const, code, error };
  }

  function consumeAndMint<T extends {
    actorId: string;
    credential: string;
    /** Only an explicit true result consumes the grant; all other values roll back. */
    accepted: boolean;
    /** Non-secret downstream result returned when enactment is rejected. */
    enactment?: unknown;
    error?: string;
  }>(
    input: ConsumeOperatorAdmissionGrantInput,
    mint: () => T,
  ):
    | ({ success: true; grant: OperatorAdmissionGrant; receipt: OperatorAdmissionReceipt } & T)
    | { success: false; code: OperatorAdmissionFailureCode; error: string; enactment?: unknown } {
    const grantId = typeof input.grantId === 'string' ? input.grantId.trim() : '';
    if (!grantId) return { success: false, code: 'VALIDATION_ERROR', error: 'grantId is required' };
    expireDue();
    const row = selectGrant.get(grantId) as GrantRow | undefined;
    if (!row) return { success: false, code: 'GRANT_NOT_FOUND', error: 'operator admission grant not found' };
    if (row.state === 'consumed') return rejection(grantId, 'GRANT_ALREADY_CONSUMED', 'operator admission grant was already consumed');
    if (row.state === 'expired') return rejection(grantId, 'GRANT_EXPIRED', 'operator admission grant expired');

    let requestedRoot: string;
    try {
      requestedRoot = validateText(input.worktreeRoot, 'worktreeRoot');
    } catch (error) {
      return rejection(grantId, 'GRANT_BINDING_MISMATCH', (error as Error).message);
    }
    const identity = typeof input.identity === 'string' ? input.identity.trim() : '';
    const roadmapSlug = typeof input.roadmapSlug === 'string' ? input.roadmapSlug.trim() : '';

    let probe: OperatorAdmissionWorktreeProbe;
    try {
      probe = probeWorktree(requestedRoot);
    } catch (error) {
      return rejection(grantId, 'GRANT_BINDING_MISMATCH', (error as Error).message);
    }
    if (identity !== row.identity || probe.root !== row.worktree_root || roadmapSlug !== row.roadmap_slug) {
      return rejection(grantId, 'GRANT_BINDING_MISMATCH', 'identity, worktree, or roadmap does not match the grant');
    }
    const invalid = validateProbe(probe);
    if (invalid) return rejection(grantId, 'GRANT_BINDING_MISMATCH', invalid);
    const mismatches = [
      probe.root !== row.worktree_root ? 'root' : null,
      probe.branch !== row.branch ? 'branch' : null,
      probe.remote !== row.remote ? 'remote' : null,
      probe.head !== row.head_sha ? 'head' : null,
      probe.base !== row.base_sha ? 'base' : null,
    ].filter(Boolean);
    if (mismatches.length > 0) {
      return rejection(grantId, 'GRANT_BINDING_MISMATCH', `live worktree drifted: ${mismatches.join(', ')}`);
    }

    try {
      return db.transaction(() => {
        const live = selectGrant.get(grantId) as GrantRow | undefined;
        if (!live) return { success: false as const, code: 'GRANT_NOT_FOUND' as const, error: 'operator admission grant not found' };
        const at = now();
        if (live.state === 'consumed') return rejection(grantId, 'GRANT_ALREADY_CONSUMED', 'operator admission grant was already consumed');
        if (live.state !== 'active' || live.expires_at <= at) {
          if (live.state === 'active') {
            db.prepare(`UPDATE operator_admission_grants SET state = 'expired' WHERE grant_id = ?`).run(grantId);
            receipt(grantId, 'expired', at, { expiresAt: live.expires_at });
          }
          return rejection(grantId, 'GRANT_EXPIRED', 'operator admission grant expired');
        }
        // Re-probe inside the immediate transaction, directly before mint.
        // The first probe keeps obviously bad requests out of the write lock;
        // this second probe closes the useful TOCTOU window between validation
        // and the one-shot state transition.
        let finalProbe: OperatorAdmissionWorktreeProbe;
        try {
          finalProbe = probeWorktree(live.worktree_root);
        } catch (error) {
          return rejection(grantId, 'GRANT_BINDING_MISMATCH', `final worktree probe failed: ${(error as Error).message}`);
        }
        const finalInvalid = validateProbe(finalProbe);
        if (finalInvalid) return rejection(grantId, 'GRANT_BINDING_MISMATCH', finalInvalid);
        const finalMismatches = [
          finalProbe.root !== live.worktree_root ? 'root' : null,
          finalProbe.branch !== live.branch ? 'branch' : null,
          finalProbe.remote !== live.remote ? 'remote' : null,
          finalProbe.head !== live.head_sha ? 'head' : null,
          finalProbe.base !== live.base_sha ? 'base' : null,
        ].filter(Boolean);
        if (finalMismatches.length > 0) {
          return rejection(grantId, 'GRANT_BINDING_MISMATCH', `final worktree probe drifted: ${finalMismatches.join(', ')}`);
        }
        const minted = mint();
        if (minted.accepted !== true) {
          throw new OperatorAdmissionEnactmentRollback(
            minted.enactment,
            minted.error || 'operator admission enactment was rejected',
          );
        }
        const changed = db.prepare(`
          UPDATE operator_admission_grants
          SET state = 'consumed', consumed_at = ?, consumed_actor_id = ?
          WHERE grant_id = ? AND state = 'active'
        `).run(at, minted.actorId, grantId).changes;
        if (changed !== 1) throw new Error('grant consume lost its atomic state transition');
        const consumedReceipt = receipt(grantId, 'consumed', at, {
          actorId: minted.actorId,
          bindingHash: live.binding_hash,
        });
        return {
          success: true as const,
          ...minted,
          grant: rowToGrant(selectGrant.get(grantId) as GrantRow),
          receipt: consumedReceipt,
        };
      }).immediate();
    } catch (error) {
      if (error instanceof OperatorAdmissionEnactmentRollback) {
        const failed = rejection(grantId, 'GRANT_ENACTMENT_REJECTED', error.message);
        return { ...failed, enactment: error.enactment };
      }
      return { success: false, code: 'STORE_UNAVAILABLE', error: (error as Error).message };
    }
  }

  function get(grantId: string): { grant: OperatorAdmissionGrant; receipts: OperatorAdmissionReceipt[] } | null {
    expireDue();
    const row = selectGrant.get(grantId) as GrantRow | undefined;
    if (!row) return null;
    return {
      grant: rowToGrant(row),
      receipts: (selectReceipts.all(grantId) as ReceiptRow[]).map(rowToReceipt),
    };
  }

  function list(): OperatorAdmissionGrant[] {
    expireDue();
    return (selectAll.all() as GrantRow[]).map(rowToGrant);
  }

  return { issue, consumeAndMint, get, list, expireDue, probeWorktree };
}

export type OperatorAdmissionGrants = ReturnType<typeof createOperatorAdmissionGrants>;
