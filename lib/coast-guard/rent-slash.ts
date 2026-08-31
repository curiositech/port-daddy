/**
 * The compulsion — rent → slash policy (ADR-0050, phase 7).
 *
 * `compulsion.ts` decides whether a lease owes coordination rent. This module
 * is the PURE policy half of the economic-enforcement loop: it turns a
 * *repeated, egregious* rent breach into a GRADUATED, PROPORTIONATE bond-slash
 * decision — the cryptoeconomic "graduated punishment" the doctrine grounds in
 * a graduated-trigger equilibrium (`whitepaper/research/program/archive/north-star/doctrine/game-theory.md §4`).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  ADVISORY-ONLY LANDING (2026-06-26) — read this first
 * ════════════════════════════════════════════════════════════════════════
 * Only the SAFE 80% of the rent→slash loop ships here: this pure policy plus
 * the per-principal breach ledger (`rent-breach-ledger.ts`). The money-moving
 * half (a `rent-slash-enforcer.ts` that calls `bonds.slash`) and the HTTP
 * routes (`POST /coast-guard/rent-breach`, `POST /coast-guard/rent-cure`) are
 * DELIBERATELY NOT SHIPPED. They carry two incentive bugs that make `enforce`
 * mode exploitable, and the right fix lands them on ADR-0087 (#500) daemon-
 * signed verdicts rather than open bearer routes:
 *   1. breach ingestion authenticated only by sessionId-possession is griefable
 *      (a neighbour's sessionId is readable via `pd sessions`);
 *   2. an unauthenticated self-cure lets a breacher cure→breach forever and
 *      never escalate (Goodhart).
 * See `docs/adr/0050-coast-guard.md` §"Phase 7 — advisory-only landing".
 *
 * So today this policy is an OBSERVABILITY instrument: a caller can compute the
 * slash that WOULD apply and log it. Nothing in this file moves money — it is
 * pure, with no I/O, no clock, no wallet, no bond.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  SAFETY POSTURE — ADVISORY BY DEFAULT
 * ════════════════════════════════════════════════════════════════════════
 * Slashing moves real money out of a principal's bond into the commons pool.
 * That is an OPERATOR DECISION, not a default. The loop is specified in three
 * modes, defaulting to the one that debits NOTHING:
 *
 *   • 'off'      — the loop is dead. No computation, no log, no debit.
 *   • 'advisory' — (DEFAULT) compute the slash that WOULD happen and LOG it
 *                  (breach + amount + reason + which principal). NEVER debit.
 *   • 'enforce'  — (NOT YET WIRED) would actually call `bonds.slash` against the
 *                  breaching principal's bond. Quarantined until it rides on
 *                  ADR-0087 signed verdicts (see the advisory-only note above).
 *
 * The mode comes from `PD_RENT_SLASH_MODE`; an unset/unknown value resolves to
 * 'advisory'. A typo never silently arms debiting. (See `resolveRentSlashMode`.)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  GRADUATION — first miss is a warning, not a fine
 * ════════════════════════════════════════════════════════════════════════
 * The note-per-commit rule already BLOCKS the next commit on the first miss
 * (`compulsion.ts` → `block-commit`). That is the proportionate response to a
 * first miss; a fine on top would be punitive and indistinguishable from
 * punishing a crash (a transient infra event reads identically to deliberate
 * defection — game-theory.md §4, crash-recovery). So:
 *
 *   • breachCount 1 (first miss)  → fraction 0 → NO slash, even in enforce.
 *   • breachCount 2+ (repeated)   → fraction = baseFraction · (breachCount − 1),
 *                                    clamped to [0, maxFraction].
 *
 * The slash is always a SMALL fraction of the bond, escalating with repetition,
 * capped well below the whole bond — never "lose your entire bond on a miss."
 *
 * ════════════════════════════════════════════════════════════════════════
 *  SYBIL / GRIEFING — slash the BREACHING principal, never a neighbour
 * ════════════════════════════════════════════════════════════════════════
 * A breach is detected against the session whose OWN sandbox produced the
 * un-noted commit. The slash targets THAT principal's bond. An agent cannot
 * name another identity to trigger a slash on it — the breach is bound to the
 * committer. The bond is keyed on the Anchor/principal semantic identity (the
 * spawn escrowed under it), not a re-rollable co-located agent id
 * (ADR-0014/0022 Sybil defense). THIS file is PURE — it computes amounts and
 * decisions from facts and never touches a wallet, a bond, or a clock.
 */

/** How the rent → slash loop behaves. Defaults to the non-debiting mode. */
export type RentSlashMode = 'off' | 'advisory' | 'enforce';

/** The default mode. Debits NOTHING. Enabling 'enforce' is an operator decision. */
export const DEFAULT_RENT_SLASH_MODE: RentSlashMode = 'advisory';

/**
 * Resolve the slash mode from an environment-style bag (defaults to
 * `process.env`). Unset, empty, or unrecognized → 'advisory'. The ONLY way to
 * reach 'enforce' is an explicit `PD_RENT_SLASH_MODE=enforce` (case-insensitive,
 * surrounding whitespace tolerated). Anything ambiguous fails SAFE to advisory —
 * a typo never silently arms debiting.
 */
export function resolveRentSlashMode(
  env: Record<string, string | undefined> = process.env,
): RentSlashMode {
  const raw = (env.PD_RENT_SLASH_MODE ?? '').trim().toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'enforce') return 'enforce';
  // 'advisory', '', and every unknown/typo value resolve to the safe default.
  return DEFAULT_RENT_SLASH_MODE;
}

/**
 * Tunables for the graduated slash. Defaults are deliberately gentle: a
 * repeated breach costs a small, escalating slice — enough to make persistent
 * dark-laning unprofitable, never enough to wipe a bond for a single human
 * lapse. Tuning these is part of the operator decision to run in enforce mode.
 */
export interface RentSlashPolicy {
  /** Breaches at or below this count are GRACE — no slash. The note-per-commit
   *  block is the whole response to a first miss. Default 1 (first miss free). */
  graceBreaches: number;
  /** Fraction of the bond per escalation step past grace. The slash fraction is
   *  `baseFraction · (breachCount − graceBreaches)`, clamped to [0, maxFraction].
   *  Default 0.10 → 10% per repeated breach. */
  baseFraction: number;
  /** Hard ceiling on the fraction of the bond a single slash may take. Default
   *  0.50 — a rent slash NEVER takes more than half the bond, however many times
   *  the principal has breached. The bond is a coordination deposit, not a
   *  death-penalty fund. */
  maxFraction: number;
}

export const DEFAULT_RENT_SLASH_POLICY: RentSlashPolicy = {
  graceBreaches: 1,
  baseFraction: 0.1,
  maxFraction: 0.5,
};

/** The facts of a single rent breach the slash policy judges. */
export interface RentBreach {
  /** The principal (Anchor / semantic identity) that committed without noting.
   *  The slash, if any, targets THIS principal's own bond — never a neighbour. */
  principal: string;
  /** The project the breaching principal's wallet/bond lives under. */
  project: string;
  /** How many rent breaches this principal has incurred, INCLUDING this one.
   *  1 = first miss. Monotonic per principal; the caller supplies it from the
   *  breach ledger so escalation survives across commits. */
  breachCount: number;
  /** Un-noted commits outstanding at the moment of breach (for the log line). */
  commitsWithoutNote: number;
}

/** What the slash policy computed for a breach. PURE — no side effects. */
export interface RentSlashDecision {
  /** True iff this breach is past grace and a positive slash is warranted. When
   *  false, the loop logs the breach but computes a zero slash (first-miss
   *  grace). */
  shouldSlash: boolean;
  /** The fraction of the bond the slash would take, in [0, maxFraction]. */
  fraction: number;
  /** The graduation step (breachCount − graceBreaches), floored at 0. */
  escalationStep: number;
  /** Stable, operator-facing reason. Points only at the corrective action; never
   *  names a bypass (guardrails-never-advertise-bypass). */
  reason: string;
}

/**
 * Compute the graduated slash for a rent breach. PURE. The fraction is a small,
 * linearly-escalating slice past the grace window, clamped to the policy cap.
 * A first miss (within grace) returns `shouldSlash: false, fraction: 0` — the
 * note-per-commit block is the proportionate response there.
 *
 * @example
 *   // First miss — grace, no fine (the commit block is the whole response):
 *   computeRentSlash({ principal: 'p:s:c', project: 'p', breachCount: 1, commitsWithoutNote: 1 });
 *   // → { shouldSlash: false, fraction: 0, escalationStep: 0, ... }
 *
 *   // Second breach — a small slice:
 *   computeRentSlash({ principal: 'p:s:c', project: 'p', breachCount: 2, commitsWithoutNote: 1 });
 *   // → { shouldSlash: true, fraction: 0.10, escalationStep: 1, ... }
 *
 *   // Persistent breacher — escalates, but capped at maxFraction:
 *   computeRentSlash({ principal: 'p:s:c', project: 'p', breachCount: 99, commitsWithoutNote: 1 });
 *   // → { shouldSlash: true, fraction: 0.50 (cap), ... }
 */
export function computeRentSlash(
  breach: RentBreach,
  policy: RentSlashPolicy = DEFAULT_RENT_SLASH_POLICY,
): RentSlashDecision {
  const breachCount = Math.max(0, Math.floor(breach.breachCount));
  const escalationStep = Math.max(0, breachCount - Math.max(0, policy.graceBreaches));

  if (escalationStep <= 0) {
    // Within grace (first miss). No fine — the commit block already bit.
    return {
      shouldSlash: false,
      fraction: 0,
      escalationStep: 0,
      reason:
        `First un-noted commit for principal ${breach.principal} — the next commit is ` +
        `blocked until a coordination note is published (pd note "..."). No bond is charged ` +
        `for a first miss.`,
    };
  }

  const rawFraction = Math.max(0, policy.baseFraction) * escalationStep;
  const fraction = Math.min(Math.max(0, rawFraction), Math.max(0, policy.maxFraction));
  const shouldSlash = fraction > 0;

  return {
    shouldSlash,
    fraction,
    escalationStep,
    reason:
      `Repeated coordination-rent breach #${breachCount} for principal ${breach.principal} ` +
      `(${breach.commitsWithoutNote} un-noted commit(s)). Publish a note per commit ` +
      `(pd note "...") to stop the escalation. Graduated bond slash: ` +
      `${(fraction * 100).toFixed(0)}% of the active bond.`,
  };
}

/**
 * The exact USD a slash would take from a bond of `bondUsd`, given a decision.
 * PURE. Clamped into [0, bondUsd] so it can be handed straight to `bonds.slash`
 * (which also clamps, belt-and-suspenders). Zero when the decision doesn't slash.
 */
export function rentSlashAmountUsd(decision: RentSlashDecision, bondUsd: number): number {
  if (!decision.shouldSlash) return 0;
  if (!Number.isFinite(bondUsd) || bondUsd <= 0) return 0;
  const amount = bondUsd * decision.fraction;
  return Math.max(0, Math.min(amount, bondUsd));
}
