/**
 * scripts/migrate-actor-souls.ts — ADR-0040 grandfather migration.
 *
 * Maps EXISTING self-asserted principals forward onto minted souls WITHOUT
 * losing data or throttling the live fleet. Idempotent; safe to re-run.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHAT IT DOES (design §7)
 * ────────────────────────────────────────────────────────────────────────────
 *  1. Collect distinct historical principals:
 *       SELECT DISTINCT agent_id FROM budget_ledger
 *       ∪ SELECT DISTINCT agent_id FROM bond_escrow
 *       ∪ SELECT id FROM agents        (live)
 *  2. For each principal with NO soul yet, mint a soul with
 *     `actor_id = <existing string>` (identity mapping — NO ledger rewrite, PKs
 *     unchanged), `credential_kind='migrated'`, `operator_trusted=1` (existing
 *     ids are trusted-by-history, so live work is not throttled on first
 *     re-registration), and ISSUE A REAL CREDENTIAL. The plaintext credential is
 *     written to ~/.port-daddy/actor-credentials/<actor_id>.cred (0600).
 *  3. So the old id becomes re-authenticable:
 *       - known-alias WITH injected credential → resolves to the grandfathered id
 *       - known-alias WITHOUT credential        → fails closed to a NEW newcomer
 *         (no impersonation into a trusted, floor-bypassed identity).
 *  4. New, unseen strings AFTER migration get NO grandfather — credential or
 *     newcomer pool. The hole is closed going forward.
 *
 * Rollback = drop actor_souls / actor_alias / newcomer_pool + the credentials
 * dir. Ledgers are never modified → lossless.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  HONEST LIMIT
 * ────────────────────────────────────────────────────────────────────────────
 *  The 0600 credential files are readable by a same-UID agent — ADR-0040's
 *  explicit non-goal (no defense against a malicious same-UID / human operator).
 *  This migration raises churn cost; it is not a cryptographic capability.
 *
 * Usage:
 *   node --loader ... scripts/migrate-actor-souls.ts            # dry-run (default)
 *   node --loader ... scripts/migrate-actor-souls.ts --apply    # write souls + creds
 */

import Database from '../lib/sqlite-runtime.js';
import { resolveDbPath } from '../lib/db.js';
import { createActorSouls } from '../lib/actor-souls.js';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_HARBOR = 'local';

export interface MigrationResult {
  scanned: number;
  minted: number;
  skipped: number;
  actorIds: string[];
  credentialsDir: string;
  applied: boolean;
}

function tableExists(db: any, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
  ).get(name);
  return !!row;
}

function distinctColumn(db: any, table: string, column: string): string[] {
  if (!tableExists(db, table)) return [];
  try {
    const rows = db.prepare(
      `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`,
    ).all() as Array<{ v: string }>;
    return rows.map((r) => r.v);
  } catch {
    return [];
  }
}

export function collectHistoricalPrincipals(db: any): string[] {
  const set = new Set<string>();
  for (const id of distinctColumn(db, 'budget_ledger', 'agent_id')) set.add(id);
  for (const id of distinctColumn(db, 'bond_escrow', 'agent_id')) set.add(id);
  for (const id of distinctColumn(db, 'agents', 'id')) set.add(id);
  return [...set];
}

/**
 * Run the migration against an already-open db. Exposed for tests (they inject
 * an in-memory db + a temp credentials dir). Idempotent.
 */
export function migrateActorSouls(
  db: any,
  opts: { apply: boolean; credentialsDir: string; harbor?: string },
): MigrationResult {
  const harbor = opts.harbor ?? DEFAULT_HARBOR;
  const souls = createActorSouls(db, { defaultHarbor: harbor });
  const principals = collectHistoricalPrincipals(db);

  const result: MigrationResult = {
    scanned: principals.length,
    minted: 0,
    skipped: 0,
    actorIds: [],
    credentialsDir: opts.credentialsDir,
    applied: opts.apply,
  };

  if (opts.apply && !existsSync(opts.credentialsDir)) {
    mkdirSync(opts.credentialsDir, { recursive: true });
    try { chmodSync(opts.credentialsDir, 0o700); } catch { /* best-effort */ }
  }

  for (const principal of principals) {
    // Idempotent: skip principals that already have a soul.
    if (souls.getSoul(principal, harbor)) {
      result.skipped++;
      continue;
    }
    if (!opts.apply) {
      result.actorIds.push(principal);
      continue;
    }

    // Mint the soul with actor_id = the existing string (identity mapping), an
    // issued credential, and operator_trusted so the live fleet is not throttled.
    // Single insert per principal; the souls store performs the write in one
    // prepared statement (atomic).
    const minted = souls.mint({
      harbor,
      alias: principal,               // the historical string is also its display alias
      operatorTrusted: true,
      credentialKind: 'migrated',
      explicitActorId: principal,
    });

    // Deliver the plaintext credential once, 0600. The daemon's fleet spawner
    // injects this as PD_ACTOR_CREDENTIAL at spawn so the old body re-authenticates.
    const credPath = join(opts.credentialsDir, `${encodeURIComponent(principal)}.cred`);
    writeFileSync(credPath, minted.credential, { mode: 0o600 });
    try { chmodSync(credPath, 0o600); } catch { /* best-effort */ }

    result.minted++;
    result.actorIds.push(minted.actorId);
  }

  return result;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dbPath = resolveDbPath();
  const credentialsDir = join(homedir(), '.port-daddy', 'actor-credentials');

  const db = new Database(dbPath);
  try {
    const result = migrateActorSouls(db, { apply, credentialsDir });
    if (!apply) {
      console.log(`[dry-run] would mint ${result.actorIds.length} migrated soul(s) ` +
        `(${result.skipped} already have souls) from ${result.scanned} historical principal(s).`);
      console.log('[dry-run] re-run with --apply to write souls + 0600 credential files.');
    } else {
      console.log(`Minted ${result.minted} migrated soul(s); skipped ${result.skipped} existing; ` +
        `credentials in ${result.credentialsDir}`);
    }
  } finally {
    db.close();
  }
}

// Only run when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('migrate-actor-souls.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('migrate-actor-souls failed:', err);
    process.exit(1);
  });
}
