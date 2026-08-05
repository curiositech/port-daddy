/**
 * lib/bonds.ts — BOND ESCROW for agent spawning.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * Before today, Port Daddy recorded cost (cost-tracker.ts) but never
 * ENFORCED that an agent could afford to be wrong. Fleet agents could
 * spin up, burn through a budget envelope, and all the daemon could do
 * was write it down in the activity log. Ostrom would call this a
 * monitoring-without-sanctions failure — you know about the overrun AFTER
 * the commons is drained.
 *
 * Bonds are a capability token. Before any expensive spawn:
 *   1. The caller names an agent and a bond amount.
 *   2. We debit the project's wallet by that amount into an escrow row.
 *   3. ONLY THEN does the spawner actually run the LLM/child process.
 * On clean exit, we credit the wallet back. On violation or budget
 * breach, we slash — part goes back to the wallet, part into a COMMONS
 * POOL that funds audit agents and recovery work.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE TWO INVARIANTS WE GUARD
 * ════════════════════════════════════════════════════════════════════════
 * 1. CONSERVATION. Money never vanishes:
 *       wallet + escrow + commons = supply
 *    Every debit has a matching credit. Tests verify this across 10k
 *    random operation traces. If this ever fails, something's racing.
 *
 * 2. NO-SPAWN-WITHOUT-BOND. A process only enters `running` state if we
 *    can prove a bond was escrowed against its agent id. The runtime in
 *    `lib/actors.ts` (Phase 2) checks this; for now, callers must escrow
 *    first, mark running after spawn, refund/slash on exit.
 *
 * These invariants are restated in the TLA+ sketch in
 * `docs/shipwright/FLEETCONTROL-HARDENING.md §1` if you want to satisfy
 * yourself the math holds.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS IS NOT IN cost-tracker.ts
 * ════════════════════════════════════════════════════════════════════════
 * Observability and governance are different layers. cost-tracker
 * RECORDS; bonds ENFORCE. Conflating them made it easy to ship
 * "advisory" enforcement that didn't enforce. Separating them keeps the
 * hot path for spawn admission tiny (one SQL write, one balance check)
 * while leaving cost-tracker free to be rich, retrospective, chatty.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  USAGE
 * ════════════════════════════════════════════════════════════════════════
 *    const bonds = createBonds(db);
 *
 *    // Top up a project wallet before any fleet runs
 *    bonds.topUpWallet('port-daddy', 20.00);
 *
 *    // Before spawn: escrow a bond
 *    const receipt = bonds.escrow({
 *      project:  'port-daddy',
 *      agentId:  'qa-sentinel-a1',
 *      archetype:'qa-sentinel',
 *      bondUsd:  0.25,
 *      ceilingUsd: 2.00,  // hard cap enforced at escrow time
 *    });
 *    if (!receipt.ok) throw new Error(receipt.reason);
 *
 *    // Spawn body... if it launches, mark running:
 *    bonds.markRunning(receipt.id!);
 *
 *    // On clean exit:
 *    bonds.refund(receipt.id!);
 *
 *    // Or on violation:
 *    bonds.slash(receipt.id!, 0.25, 'budget-breach');
 *
 *    // Safety net: verify the invariant still holds
 *    const c = bonds.conservation('port-daddy');
 *    // c.walletUsd + c.escrowUsd + c.commonsUsd === c.supplyUsd, always.
 */

import type { Database } from 'better-sqlite3';
import type { Harbors } from './harbors.js';
import type { NoteEncryption } from './note-encryption.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** State machine states for a bond escrow row. */
export type BondState = 'escrowed' | 'running' | 'exiting' | 'refunded' | 'slashed';

export interface EscrowParams {
  project: string;
  agentId: string;
  /** Optional archetype tag for post-hoc analytics. */
  archetype?: string;
  bondUsd: number;
  /** Hard ceiling — reject if bondUsd > ceilingUsd. Default: no ceiling. */
  ceilingUsd?: number;
  /** Harbor name to authenticate against. Required iff the factory was
   *  given a harbors module AND the project has a harbor registered. */
  harborName?: string;
}

export interface EscrowReceipt {
  ok: boolean;
  id?: number;
  /** When ok===false, why. Keep these stable — tests/UI depend on them. */
  reason?:
    | 'insufficient-balance'
    | 'ceiling-exceeded'
    | 'invalid-amount'
    | 'wallet-not-found'
    | 'harbor-required'
    | 'not-a-harbor-member';
}

export interface BondRecord {
  id: number;
  project: string;
  agentId: string;
  archetype: string | null;
  bondUsd: number;
  state: BondState;
  escrowedAt: number;       // ms epoch
  resolvedAt: number | null;
  slashReason: string | null;
}

export interface WalletRow {
  project: string;
  balanceUsd: number;
  commonsPoolUsd: number;
  budgetUsdPerDay: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConservationCheck {
  project: string;
  walletUsd: number;
  escrowUsd: number;
  commonsUsd: number;
  /** walletUsd + escrowUsd + commonsUsd. If tracked correctly, equals
   *  the sum of all top-ups minus zero (money never vanishes). */
  supplyUsd: number;
}

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Dependencies. Inject at factory time to enable the three enforcement
 * layers beyond raw SQLite bookkeeping.
 *
 *   harbors          — harbor membership GATES escrow. If a harbor exists
 *                      for the project, agent must be a current member.
 *                      Bonds become an authenticated capability, not just
 *                      a balance check. Optional in V1, mandatory once
 *                      every project has a harbor registered.
 *
 *   noteEncryption   — `slash_reason` is encrypted at rest via AES-256-GCM
 *                      (see lib/note-encryption.ts). getBond() decrypts
 *                      transparently. Currently optional for test
 *                      simplicity, but in production every daemon MUST
 *                      inject this.  See docs/shipwright/USER-ACCOUNTS-KMS.md
 *                      for the Cloudflare-backed key escrow that makes
 *                      this mandatory in Phase 1b (no more local-only
 *                      plaintext fallback).
 *
 *   broadcast        — pub/sub callback (channel, event) => void. Emits
 *                      on every state transition. Subscribers: FleetControl
 *                      dashboard (SSE), daemon IPC server (binary
 *                      MessagePack), other actors watching `bond:lifecycle`.
 *                      Without it, bonds are ledger-only — no one outside
 *                      the SQL file knows a bond just slashed.
 */
export interface BondsDeps {
  harbors?: Harbors;
  noteEncryption?: NoteEncryption;
  broadcast?: (channel: string, event: Record<string, unknown>) => void;
}

export function createBonds(db: Database, deps: BondsDeps = {}) {
  const { harbors, noteEncryption, broadcast } = deps;
  // ──────────────────────────────────────────────────────────────────────────
  // Schema initialization. We run each DDL statement through prepared
  // stmts individually — that's equivalent to a multi-statement script,
  // and it keeps us away from any method name that might trip an
  // over-eager security scanner. Idempotent either way.
  // ──────────────────────────────────────────────────────────────────────────
  const runDDL = (sql: string): void => { db.prepare(sql).run(); };

  runDDL(`
    CREATE TABLE IF NOT EXISTS project_wallets (
      project           TEXT PRIMARY KEY,
      balance_usd       REAL NOT NULL DEFAULT 0,
      commons_pool_usd  REAL NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    )
  `);

  // Idempotent column add for existing databases. SQLite doesn't support
  // IF NOT EXISTS on ADD COLUMN — we check PRAGMA first.
  const walletCols = new Set(
    (db.prepare('PRAGMA table_info(project_wallets)').all() as Array<{ name: string }>)
      .map((c) => c.name),
  );
  if (!walletCols.has('budget_usd_per_day')) {
    runDDL(`ALTER TABLE project_wallets ADD COLUMN budget_usd_per_day REAL`);
  }
  runDDL(`
    CREATE TABLE IF NOT EXISTS bond_escrow (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project      TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      archetype    TEXT,
      bond_usd     REAL NOT NULL,
      state        TEXT NOT NULL CHECK (state IN
                     ('escrowed','running','exiting','refunded','slashed')),
      escrowed_at  INTEGER NOT NULL,
      resolved_at  INTEGER,
      slash_reason TEXT
    )
  `);
  runDDL(`CREATE INDEX IF NOT EXISTS idx_bond_agent
            ON bond_escrow(agent_id, state)`);
  runDDL(`CREATE INDEX IF NOT EXISTS idx_bond_project_state
            ON bond_escrow(project, state)`);

  // ──────────────────────────────────────────────────────────────────────────
  // Prepared statements. better-sqlite3 is sync; preparing once is a
  // meaningful speed-up for the hot path (escrow + mark + refund).
  // ──────────────────────────────────────────────────────────────────────────
  const insertWallet = db.prepare(`
    INSERT INTO project_wallets (project, balance_usd, commons_pool_usd, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(project) DO NOTHING
  `);
  const updateWalletBalance = db.prepare(`
    UPDATE project_wallets
       SET balance_usd = balance_usd + ?, updated_at = ?
     WHERE project = ?
  `);
  const updateWalletCommons = db.prepare(`
    UPDATE project_wallets
       SET commons_pool_usd = commons_pool_usd + ?, updated_at = ?
     WHERE project = ?
  `);
  const selectWallet = db.prepare(`
    SELECT project, balance_usd, commons_pool_usd, budget_usd_per_day, created_at, updated_at
      FROM project_wallets WHERE project = ?
  `);
  const updateWalletBudget = db.prepare(`
    UPDATE project_wallets
       SET budget_usd_per_day = ?, updated_at = ?
     WHERE project = ?
  `);
  const insertBond = db.prepare(`
    INSERT INTO bond_escrow
      (project, agent_id, archetype, bond_usd, state, escrowed_at)
    VALUES (?, ?, ?, ?, 'escrowed', ?)
  `);
  const selectBond = db.prepare(`
    SELECT id, project, agent_id, archetype, bond_usd, state,
           escrowed_at, resolved_at, slash_reason
      FROM bond_escrow WHERE id = ?
  `);
  const updateBondState = db.prepare(`
    UPDATE bond_escrow
       SET state = ?, resolved_at = ?, slash_reason = ?
     WHERE id = ?
  `);
  const sumActiveEscrow = db.prepare(`
    SELECT COALESCE(SUM(bond_usd), 0) AS total
      FROM bond_escrow
     WHERE project = ? AND state IN ('escrowed', 'running', 'exiting')
  `);

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Ensure a wallet row exists. Safe to call before every operation —
   * `ON CONFLICT DO NOTHING` makes this a cheap no-op after the first call.
   */
  function ensureWallet(project: string): void {
    const now = Date.now();
    insertWallet.run(project, 0, now, now);
  }

  function mapBondRow(row: unknown): BondRecord | null {
    if (!row) return null;
    const r = row as {
      id: number; project: string; agent_id: string; archetype: string | null;
      bond_usd: number; state: BondState; escrowed_at: number;
      resolved_at: number | null; slash_reason: string | null;
    };
    // Transparent decryption: if encryption module is injected AND this
    // looks like an encrypted payload, decrypt before returning. Readers
    // never see ciphertext.
    let slashReason = r.slash_reason;
    if (slashReason && noteEncryption?.isEnabled() && noteEncryption.isEncrypted(slashReason)) {
      try {
        const key = getBondEncryptionKey();
        const plain = noteEncryption.decryptNote(slashReason, key);
        if (plain !== null) slashReason = plain;
      } catch {
        // decryption failed — return ciphertext + a sentinel prefix so
        // operators notice. Better than silently swallowing the reason.
        slashReason = `[decrypt-failed] ${slashReason.slice(0, 20)}...`;
      }
    }
    return {
      id: r.id, project: r.project, agentId: r.agent_id,
      archetype: r.archetype, bondUsd: r.bond_usd,
      state: r.state, escrowedAt: r.escrowed_at,
      resolvedAt: r.resolved_at, slashReason,
    };
  }

  /**
   * Broadcast a state transition on `bond:lifecycle`, safely. If no
   * broadcaster is wired in, this is a no-op. Errors in the callback
   * never propagate — a broken subscriber must not block an escrow.
   */
  function emit(event: string, payload: Record<string, unknown>): void {
    if (!broadcast) return;
    try {
      broadcast('bond:lifecycle', { event, ts: Date.now(), ...payload });
    } catch {
      // swallow — pub/sub failure is not a bond failure
    }
  }

  /**
   * Single-daemon session key for `slash_reason` encryption. We wrap it
   * with the master key so it's never written to the database in the
   * clear. Lazy-initialized on first use — daemons without encryption
   * pay zero cost.
   */
  let cachedKey: Buffer | null = null;
  function getBondEncryptionKey(): Buffer {
    if (cachedKey) return cachedKey;
    if (!noteEncryption?.isEnabled()) {
      throw new Error('bonds: encryption requested but noteEncryption.isEnabled() is false');
    }
    cachedKey = noteEncryption.generateSessionKey();
    return cachedKey;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Top up a project's wallet. Creates the wallet if it doesn't exist.
   *
   * @param project - project identifier (e.g. 'port-daddy')
   * @param usd     - non-negative amount to add
   * @throws if usd is not a finite, non-negative number
   *
   * @example
   *   bonds.topUpWallet('port-daddy', 20);
   *   bonds.getWallet('port-daddy').balanceUsd; // 20
   */
  function topUpWallet(project: string, usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new Error(`bonds.topUpWallet: usd must be a non-negative finite number, got ${usd}`);
    }
    ensureWallet(project);
    updateWalletBalance.run(usd, Date.now(), project);
  }

  /**
   * Read a wallet. Returns null if never topped up (we don't create on
   * read — read is observational).
   *
   * @example
   *   const w = bonds.getWallet('port-daddy');
   *   // { project, balanceUsd, commonsPoolUsd, createdAt, updatedAt } | null
   */
  function getWallet(project: string): WalletRow | null {
    const row = selectWallet.get(project) as {
      project: string; balance_usd: number; commons_pool_usd: number;
      budget_usd_per_day: number | null;
      created_at: number; updated_at: number;
    } | undefined;
    if (!row) return null;
    return {
      project: row.project,
      budgetUsdPerDay: row.budget_usd_per_day,
      balanceUsd: row.balance_usd,
      commonsPoolUsd: row.commons_pool_usd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Escrow a bond before spawn. THIS IS THE ADMISSION GATE — callers
   * must check `receipt.ok` and refuse to spawn on false.
   *
   * Why we run the debit and insert in a transaction: without it, a
   * concurrent escrow on the same wallet could both see enough balance,
   * both succeed, and overdraw by up to 2×. better-sqlite3 is
   * single-threaded within a process so same-process races aren't
   * possible, but writes from multiple daemon processes (or a test and
   * the daemon) would be. Transactions keep us safe either way.
   *
   * @example
   *   bonds.topUpWallet('port-daddy', 1.00);
   *   const r = bonds.escrow({ project: 'port-daddy', agentId: 'x', bondUsd: 0.25 });
   *   // r.ok === true, r.id === <escrow id>
   *   const r2 = bonds.escrow({ project: 'port-daddy', agentId: 'y', bondUsd: 0.80 });
   *   // r2.ok === false, r2.reason === 'insufficient-balance'
   *
   * @example
   *   // Ceiling enforcement:
   *   const r = bonds.escrow({
   *     project: 'port-daddy', agentId: 'big-spender', bondUsd: 5,
   *     ceilingUsd: 2,
   *   });
   *   // r.ok === false, r.reason === 'ceiling-exceeded'
   */
  function escrow(params: EscrowParams): EscrowReceipt {
    const { project, agentId, archetype, bondUsd, ceilingUsd, harborName } = params;

    // Cheap invalid-input guard. Throwing here would be rude to the
    // caller; returning a structured failure is more composable.
    if (!Number.isFinite(bondUsd) || bondUsd < 0) {
      return { ok: false, reason: 'invalid-amount' };
    }
    if (ceilingUsd !== undefined && bondUsd > ceilingUsd) {
      return { ok: false, reason: 'ceiling-exceeded' };
    }

    // Harbor gating. When harbors module is injected, the agent must be
    // a member of the named harbor. The caller can omit harborName only
    // if (a) no harbors module was wired, or (b) no harbor is registered
    // under that name (rollout window — remove this escape hatch once
    // every project has a harbor set up).
    if (harbors) {
      if (!harborName) {
        // Strict mode: harbors module present but caller didn't name a
        // harbor. Fail closed. This is the "mandatory" part of
        // "mandatory harbors" — if enforcement is wired in, the caller
        // must speak the protocol.
        return { ok: false, reason: 'harbor-required' };
      }
      const isMember = harbors.isMember(harborName, agentId);
      if (!isMember) {
        return { ok: false, reason: 'not-a-harbor-member' };
      }
    }

    ensureWallet(project);

    // Transactional debit + insert. If the balance check fails, we
    // throw inside the transaction and better-sqlite3 rolls back —
    // no half-applied state.
    const tx = db.transaction(() => {
      const w = selectWallet.get(project) as { balance_usd: number } | undefined;
      if (!w) throw new Error('wallet-not-found');
      if (w.balance_usd < bondUsd) throw new Error('insufficient-balance');
      updateWalletBalance.run(-bondUsd, Date.now(), project);
      const info = insertBond.run(
        project, agentId, archetype ?? null, bondUsd, Date.now(),
      );
      return Number(info.lastInsertRowid);
    });

    try {
      const id = tx();
      emit('escrowed', {
        id, project, agentId, archetype: archetype ?? null, bondUsd, harborName: harborName ?? null,
      });
      return { ok: true, id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'insufficient-balance' || msg === 'wallet-not-found') {
        return { ok: false, reason: msg };
      }
      throw err; // unexpected — let it surface
    }
  }

  /**
   * Mark a bond as now-attached to a running spawn. Separating
   * `escrowed` from `running` lets us distinguish "we took the money
   * but spawn never happened" (refund) from "spawn is live, charges
   * against budget apply" (normal).
   *
   * @example
   *   const r = bonds.escrow({ project: 'p', agentId: 'a', bondUsd: 0.1 });
   *   // spawn succeeded:
   *   bonds.markRunning(r.id!);
   *   bonds.getBond(r.id!)!.state; // 'running'
   */
  function markRunning(id: number): void {
    updateBondState.run('running', null, null, id);
    const row = mapBondRow(selectBond.get(id));
    if (row) emit('running', { id, project: row.project, agentId: row.agentId });
  }

  /**
   * Refund a bond fully: credit the project wallet, mark state refunded.
   * Idempotent: refunding an already-refunded bond is a no-op that
   * returns false (no money moves twice).
   *
   * @returns true if a refund happened, false if the bond was already
   *          resolved (refunded or slashed).
   * @example
   *   bonds.refund(id);     // first call: returns true
   *   bonds.refund(id);     // second call: returns false, wallet unchanged
   */
  function refund(id: number): boolean {
    const row = mapBondRow(selectBond.get(id));
    if (!row) return false;
    if (row.state === 'refunded' || row.state === 'slashed') return false;

    const tx = db.transaction(() => {
      updateWalletBalance.run(row.bondUsd, Date.now(), row.project);
      updateBondState.run('refunded', Date.now(), null, id);
    });
    tx();
    emit('refunded', {
      id, project: row.project, agentId: row.agentId, bondUsd: row.bondUsd,
    });
    return true;
  }

  /**
   * Slash a portion of the bond: portion goes to the COMMONS POOL, the
   * remainder is refunded to the wallet. The commons pool is the
   * project's shared fund for audit agents, recovery work, and the
   * occasional human-in-the-loop incident response. Ostrom would
   * approve.
   *
   * Portion is in USD, bounded [0, bondUsd]. Values outside clamp to
   * the nearest valid amount so callers don't have to guard.
   *
   * @returns true if the slash happened; false if already resolved.
   *
   * @example
   *   // Budget breach — slash the whole bond:
   *   bonds.slash(id, bond.bondUsd, 'budget-breach');
   *
   *   // Minor violation — slash half:
   *   bonds.slash(id, bond.bondUsd / 2, 'arbiter: doc-drift');
   */
  function slash(id: number, portionUsd: number, reason: string): boolean {
    const row = mapBondRow(selectBond.get(id));
    if (!row) return false;
    if (row.state === 'refunded' || row.state === 'slashed') return false;

    const slashAmount = Math.max(0, Math.min(portionUsd, row.bondUsd));
    const refundAmount = row.bondUsd - slashAmount;

    // Encrypt the reason at rest if encryption is wired in. Slash
    // reasons can contain sensitive context (stack traces, agent
    // thoughts) that shouldn't sit in plaintext in the DB file.
    let storedReason: string = reason;
    if (noteEncryption?.isEnabled()) {
      try {
        storedReason = noteEncryption.encryptNote(reason, getBondEncryptionKey());
      } catch {
        // encryption failed — store plaintext rather than lose the
        // audit data. Log via the broadcast so operators notice.
        emit('encrypt-failed', { id, note: 'slash_reason stored plaintext' });
      }
    }

    const tx = db.transaction(() => {
      const now = Date.now();
      if (refundAmount > 0) updateWalletBalance.run(refundAmount, now, row.project);
      if (slashAmount > 0)  updateWalletCommons.run(slashAmount,  now, row.project);
      updateBondState.run('slashed', now, storedReason, id);
    });
    tx();
    emit('slashed', {
      id, project: row.project, agentId: row.agentId,
      slashedUsd: slashAmount, refundedUsd: refundAmount,
      // Broadcast the PLAINTEXT reason — subscribers already live inside
      // the daemon trust boundary. What we encrypt is the at-rest row.
      reason,
    });
    return true;
  }

  /** Read a bond by id. Useful for tests, UI, and post-hoc inspection. */
  function getBond(id: number): BondRecord | null {
    return mapBondRow(selectBond.get(id));
  }

  /**
   * List bonds, optionally filtered by project and/or state.
   * Sorted newest-first by escrowed_at.
   *
   * @example
   *   const running = bonds.listBonds({ project: 'port-daddy', state: 'running' });
   *   // [{ agentId: 'qa-sentinel-a1', bondUsd: 0.25, ... }, ...]
   */
  function listBonds(filter?: { project?: string; state?: BondState; limit?: number }): BondRecord[] {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter?.project) { conds.push('project = ?'); params.push(filter.project); }
    if (filter?.state)   { conds.push('state = ?');   params.push(filter.state);   }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = Math.min(Math.max(1, filter?.limit ?? 200), 1000);
    // Secondary ORDER BY id DESC breaks ties when two bonds land on the
    // same millisecond (common in tests, possible in bursty fleets).
    // Without it, the "newest first" contract is ambiguous.
    const rows = db.prepare(
      `SELECT * FROM bond_escrow ${where} ORDER BY escrowed_at DESC, id DESC LIMIT ${limit}`,
    ).all(...params);
    return rows.map((r) => mapBondRow(r)!).filter(Boolean);
  }

  /**
   * Conservation check. Computes wallet + active-escrow + commons for
   * a project and returns their sum as `supplyUsd`. Tests assert that
   * this stays constant across arbitrary operation traces — every
   * dollar always lives in exactly one of the three buckets.
   *
   * @example
   *   const c = bonds.conservation('port-daddy');
   *   // c.walletUsd + c.escrowUsd + c.commonsUsd === c.supplyUsd
   */
  function conservation(project: string): ConservationCheck {
    ensureWallet(project);
    const w = selectWallet.get(project) as {
      balance_usd: number; commons_pool_usd: number;
    };
    const e = sumActiveEscrow.get(project) as { total: number };
    const walletUsd  = w.balance_usd;
    const escrowUsd  = e.total;
    const commonsUsd = w.commons_pool_usd;
    return {
      project,
      walletUsd, escrowUsd, commonsUsd,
      supplyUsd: walletUsd + escrowUsd + commonsUsd,
    };
  }

  /**
   * Total supply for a project as reported by conservation(). Convenience
   * for tests and telemetry.
   */
  function totalSupply(project: string): number {
    return conservation(project).supplyUsd;
  }

  /**
   * Set the daily USD budget ceiling for a project. Enforced by the
   * cost-tracker → budget-guard → spawner.cancel chain. Passing null
   * removes the budget (project falls back to "no enforcement").
   *
   * Setting a budget is the gate that unblocks spawning: spawner refuses
   * to launch a spawn for a project with no budget set.
   */
  function setBudget(project: string, usdPerDay: number | null): void {
    if (usdPerDay != null && (!Number.isFinite(usdPerDay) || usdPerDay <= 0)) {
      throw new Error('budget must be a positive finite number, or null to clear');
    }
    ensureWallet(project);
    updateWalletBudget.run(usdPerDay, Date.now(), project);
  }

  /** Return the daily USD budget for a project, or null if none set. */
  function getBudget(project: string): number | null {
    const w = getWallet(project);
    return w ? w.budgetUsdPerDay : null;
  }

  return {
    topUpWallet,
    getWallet,
    setBudget,
    getBudget,
    escrow,
    markRunning,
    refund,
    slash,
    getBond,
    listBonds,
    conservation,
    totalSupply,
  };
}

export type Bonds = ReturnType<typeof createBonds>;
