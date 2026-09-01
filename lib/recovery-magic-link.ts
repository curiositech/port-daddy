/**
 * Magic-Link Recovery Token Management
 *
 * Spec:    whitepaper/formal/proverif/bonded/recovery/magic-link.pv
 * Runtime: lib/recovery-magic-link.ts  (you are here)
 *
 * The .pv proves two security properties:
 *
 *   (S) single-use / injective correspondence:
 *       inj-event(consumed_for(a, tk)) ==> inj-event(issued_for(a, tk))
 *       Every consume corresponds to a UNIQUE issue. The private-channel
 *       model drains the cap in one atomic step; no second consume can
 *       proceed.
 *
 *   (B) binding:
 *       event(consumed_for(a, tk)) ==> event(issued_for(a, tk))
 *       The account_id and token returned by consume match the pair used
 *       during issue.
 *
 * Runtime analogue of ProVerif's private-channel `in(ch_tk, cap)`:
 *
 *   UPDATE recovery_tokens
 *      SET consumed_at = ?
 *    WHERE token = ?
 *      AND consumed_at IS NULL
 *      AND expires_at > ?
 *    RETURNING *
 *
 * SQLite serializes concurrent writers, so this UPDATE+RETURNING is an
 * atomic step. Exactly one concurrent call can observe `consumed_at IS NULL`
 * and succeed; all subsequent calls find `consumed_at NOT NULL` and return
 * zero rows — mirroring the channel being permanently drained after one read.
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

/** Token lifetime — 15 minutes, matching common magic-link UX expectations. */
export const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1_000;

/** 32 bytes of entropy -> 64 hex chars, 256-bit security margin. */
export const RECOVERY_TOKEN_BYTES = 32;

export interface RecoveryToken {
  token: string;
  account_id: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

export function createRecoveryMagicLink(db: Database.Database) {
  /** Self-initializing: safe to call multiple times (idempotent). */
  function initRecoveryTokens(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_tokens (
        token       TEXT    PRIMARY KEY,
        account_id  TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rt_account
        ON recovery_tokens(account_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_rt_expires
        ON recovery_tokens(expires_at)
        WHERE consumed_at IS NULL;
    `);
  }

  /**
   * Issue a fresh single-use recovery token for accountId.
   *
   * Models the Issuer process in magic-link.pv:
   *   1. new tk  -- fresh token with RECOVERY_TOKEN_BYTES entropy
   *   2. new ch_tk + out(ch_tk, ()) -- one row inserted; consumed_at IS NULL
   *   3. out(pub, mkLink(tk, a)) -- caller receives the token to deliver
   */
  function issueToken(accountId: string): RecoveryToken {
    const token = randomBytes(RECOVERY_TOKEN_BYTES).toString('hex');
    const now = Date.now();
    const expiresAt = now + RECOVERY_TOKEN_TTL_MS;

    db.prepare(
      `INSERT INTO recovery_tokens (token, account_id, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(token, accountId, now, expiresAt);

    return { token, account_id: accountId, created_at: now, expires_at: expiresAt, consumed_at: null };
  }

  /**
   * Atomically consume a recovery token.
   *
   * Models the Consumer process in magic-link.pv:
   *   in(ch_tk, cap)  -- the UPDATE drains the single-use cap atomically.
   *   event consumed_for(a, tk) -- fires only if the UPDATE returns a row.
   *
   * Returns the token row on success (first and only consume).
   * Returns null if the token is unknown, already consumed, or expired.
   */
  function consumeToken(token: string): RecoveryToken | null {
    const now = Date.now();

    const row = db
      .prepare<[number, string, number]>(
        `UPDATE recovery_tokens
            SET consumed_at = ?
          WHERE token = ?
            AND consumed_at IS NULL
            AND expires_at > ?
          RETURNING *`,
      )
      .get(now, token, now) as RecoveryToken | undefined;

    return row ?? null;
  }

  /** Read a token row without consuming it (for audits / tests). */
  function getToken(token: string): RecoveryToken | null {
    return (
      (db
        .prepare(`SELECT * FROM recovery_tokens WHERE token = ?`)
        .get(token) as RecoveryToken | undefined) ?? null
    );
  }

  return { initRecoveryTokens, issueToken, consumeToken, getToken };
}

export type RecoveryMagicLink = ReturnType<typeof createRecoveryMagicLink>;
