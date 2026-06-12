/**
 * The compulsion — rent → slash enforcer (ADR-0050, phase 7).
 *
 * The impure half of the rent→slash loop. `rent-slash.ts` is the pure policy
 * (mode resolution + graduated amount); this module wires that policy to the
 * bond ledger. It resolves the BREACHING principal's own bond, LOGS what would
 * happen, and — ONLY in enforce mode — calls `bonds.slash` with the graduated
 * amount.
 *
 * SAFETY (restated, because this is the file that can move money):
 *   • mode 'off'      → returns immediately. No log, no lookup, no debit.
 *   • mode 'advisory' → (DEFAULT) resolves the bond + logs the slash that WOULD
 *                       happen. Calls NOTHING on `bonds`. The wallet/commons are
 *                       provably untouched.
 *   • mode 'enforce'  → (operator opt-in) calls `bonds.slash(bondId, amount,
 *                       reason)` against the breaching principal's bond. The
 *                       slash itself preserves conservation (wallet+escrow+commons
 *                       = supply) because `bonds.slash` splits, never destroys.
 *
 * Sybil/griefing: the bond is resolved by matching the breaching PRINCIPAL's own
 * semantic identity against `bond.agentId` within the breaching project. The
 * caller derives the principal from the session that actually committed; an
 * agent cannot pass a neighbour's identity here to slash it.
 */

import type { Bonds, BondRecord } from '../bonds.js';
import {
  computeRentSlash,
  rentSlashAmountUsd,
  type RentBreach,
  type RentSlashMode,
  type RentSlashPolicy,
  type RentSlashDecision,
  DEFAULT_RENT_SLASH_POLICY,
} from './rent-slash.js';

/** Stable reason prefix written into the bond's slash_reason on enforce. */
export const RENT_SLASH_REASON_PREFIX = 'rent-breach';

/** A logger shaped like the standard console (so the daemon's logger drops in). */
export interface RentSlashLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface RentSlashEnforcerDeps {
  bonds: Bonds;
  mode: RentSlashMode;
  policy?: RentSlashPolicy;
  /** Defaults to `console`. Injected for testable, assertable logging. */
  logger?: RentSlashLogger;
}

/** Why no bond was acted on, when `bondId` is null. */
export type RentSlashSkipReason =
  | 'mode-off'
  | 'grace' // first miss — graduated policy says no slash
  | 'no-active-bond'; // the breaching principal has no escrowed/running bond to slash

export interface RentSlashOutcome {
  /** The resolved mode this outcome was produced under. */
  mode: RentSlashMode;
  /** The pure decision (fraction, escalation, reason). Null only when mode 'off'
   *  (we skip the computation entirely). */
  decision: RentSlashDecision | null;
  /** The bond that was (advisory: would be / enforce: was) targeted, or null. */
  bondId: number | null;
  /** The USD the slash took (enforce) or WOULD take (advisory). 0 in grace/off. */
  amountUsd: number;
  /** True iff `bonds.slash` was actually called AND moved money. Always false in
   *  off/advisory — the load-bearing safety assertion for the advisory default. */
  slashed: boolean;
  /** Present when no bond was acted on. */
  skipReason?: RentSlashSkipReason;
}

/**
 * Resolve the single active bond to slash for a breaching principal. We match
 * the principal's OWN semantic identity against `bond.agentId`, scoped to the
 * breaching project, among bonds that are still live (escrowed/running/exiting —
 * i.e. not already refunded/slashed). When more than one matches (a principal
 * with several live bonds), we take the most-recently escrowed — `listBonds`
 * already returns newest-first. Returns null when the principal holds no live
 * bond (nothing to slash; we log and move on).
 */
function resolveBreachingBond(bonds: Bonds, breach: RentBreach): BondRecord | null {
  // Pull the project's live bonds (newest-first) and find the breaching
  // principal's own. We deliberately do NOT slash a bond owned by any other
  // identity, even within the same project — the breach is the committer's.
  const live = bonds
    .listBonds({ project: breach.project, limit: 1000 })
    .filter((b) => b.state === 'escrowed' || b.state === 'running' || b.state === 'exiting');
  return live.find((b) => b.agentId === breach.principal) ?? null;
}

/**
 * Apply the rent→slash loop for a single breach. Pure-ish: the only side effects
 * are (a) logging in advisory/enforce and (b) `bonds.slash` in enforce. Returns
 * a structured outcome so callers (and tests) can assert exactly what happened.
 */
export function applyRentSlash(deps: RentSlashEnforcerDeps, breach: RentBreach): RentSlashOutcome {
  const { bonds, mode } = deps;
  const policy = deps.policy ?? DEFAULT_RENT_SLASH_POLICY;
  const logger = deps.logger ?? console;

  // Mode 'off' — the loop is dead. Do nothing, touch nothing, say nothing.
  if (mode === 'off') {
    return { mode, decision: null, bondId: null, amountUsd: 0, slashed: false, skipReason: 'mode-off' };
  }

  const decision = computeRentSlash(breach, policy);

  // The breach is always worth a log line — that is the whole point of the
  // advisory default: make the breach visible without charging for it.
  logger.info(
    `[rent-slash] breach detected — principal=${breach.principal} project=${breach.project} ` +
      `breach#=${breach.breachCount} unNotedCommits=${breach.commitsWithoutNote} mode=${mode}`,
  );

  // Grace (first miss): the graduated policy charges nothing. The commit block
  // upstream is the proportionate response; we log and stop.
  if (!decision.shouldSlash) {
    logger.info(`[rent-slash] within grace — no slash. ${decision.reason}`);
    return { mode, decision, bondId: null, amountUsd: 0, slashed: false, skipReason: 'grace' };
  }

  // Resolve the breaching principal's OWN live bond.
  const bond = resolveBreachingBond(bonds, breach);
  if (!bond) {
    logger.warn(
      `[rent-slash] no active bond for principal=${breach.principal} (project=${breach.project}) — ` +
        `cannot slash; the breach is recorded but uncollectable. ${decision.reason}`,
    );
    return { mode, decision, bondId: null, amountUsd: 0, slashed: false, skipReason: 'no-active-bond' };
  }

  const amountUsd = rentSlashAmountUsd(decision, bond.bondUsd);
  const reason = `${RENT_SLASH_REASON_PREFIX}: ${decision.reason}`;

  // ── ADVISORY (DEFAULT): log the slash that WOULD happen. Debit NOTHING. ──
  if (mode === 'advisory') {
    logger.warn(
      `[rent-slash] ADVISORY (no debit) — WOULD slash $${amountUsd.toFixed(4)} ` +
        `(${(decision.fraction * 100).toFixed(0)}% of $${bond.bondUsd.toFixed(4)}) ` +
        `from bond#${bond.id} owned by principal=${bond.agentId}. ` +
        `Set PD_RENT_SLASH_MODE=enforce to make this a real debit. ${decision.reason}`,
    );
    return { mode, decision, bondId: bond.id, amountUsd, slashed: false };
  }

  // ── ENFORCE (operator opt-in): the real debit. ──
  // `bonds.slash` splits the amount (slashed → commons, remainder → wallet) and
  // preserves conservation. It returns false if the bond was already resolved.
  const ok = bonds.slash(bond.id, amountUsd, reason);
  if (ok) {
    logger.warn(
      `[rent-slash] ENFORCED — slashed $${amountUsd.toFixed(4)} ` +
        `(${(decision.fraction * 100).toFixed(0)}% of $${bond.bondUsd.toFixed(4)}) ` +
        `from bond#${bond.id} owned by principal=${bond.agentId} → commons. ${decision.reason}`,
    );
  } else {
    logger.warn(
      `[rent-slash] ENFORCE — bond#${bond.id} (principal=${bond.agentId}) was already resolved; ` +
        `no debit applied. ${decision.reason}`,
    );
  }
  return { mode, decision, bondId: bond.id, amountUsd, slashed: ok };
}
