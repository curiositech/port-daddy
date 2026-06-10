/**
 * lib/bond-pricing.ts — SCOPE-PROPORTIONAL BOND PRICER (closed-form floor).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * `lib/bonds.ts` ships the escrow/refund/slash ledger and the proven
 * conservation invariant (wallet + escrow + commons = supply). But its
 * admission gate, `escrow({ bondUsd, ... })`, takes a CALLER-SUPPLIED
 * `bondUsd` constant. The mechanism-design literature calls that **Fixed
 * Bonds** — the weakest pricing tier:
 *
 *     bond(task) = CONSTANT          // overprices trivial work,
 *                                    // underprices critical work,
 *                                    // creates adverse selection.
 *
 * This module computes the `bondUsd` that callers pass in, moving Port
 * Daddy from Fixed Bonds to a **complexity-proportional** pricer. It is
 * the closed-form floor from the Bonded Commons paper, Chapter VI
 * (`website-v2/public/whitepaper/agent-transactions-whitepaper.tex`,
 * §6.5 "Pricing the Bond"):
 *
 *     π(F, p) = c · (1 + α · s(F)) · (1 − ρ(p))           [§6.5, line 778]
 *
 * where
 *   • c     — cleanup cost lower bound (Theorem "Cleanup Lower Bound",
 *             §6.5.1: π(F) ≥ c, or breach is cheaper than recovery and the
 *             commons bankrupts itself per breach). The pricer's `baseUsd`.
 *   • s(F)  — consequential scope of the Float Plan: "files claimed,
 *             presence of db:write, production-deployment capability"
 *             (§6.5.2). Cleanup scales SUPER-LINEARLY with scope, so we
 *             encode s as a tiered multiplier, not a raw file count.
 *   • α     — calibration slope, "observed cleanup per scope unit" (§6.5.2),
 *             folded into the per-tier scope multipliers below.
 *   • ρ(p)  — reputation discount, ρ(p) ∈ [0, r_max], r_max ≤ 0.5 "to
 *             prevent trivialization" (§6.5.3). Keyed on the PRINCIPAL p,
 *             never the re-rollable agent id (the Sybil defense, below).
 *
 * The COMPETITIVE-INSURANCE market that sits on top of this closed form
 * (§6.5.6 "The Bonded Advisor", §6.5.7 Youle) is explicitly OUT OF SCOPE:
 * this is the deterministic floor every deployment runs before a thick
 * insurer market exists (paper §6.5.7 "Bootstrap Path", Phase 2).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE FOUR PROPERTIES π MUST SATISFY (paper §6.5, enumerated)
 * ════════════════════════════════════════════════════════════════════════
 *   1. Deterrence    — π must exceed expected damage from defection under
 *                      the plan's scope. Encoded as per-tier IC FLOORS:
 *                      bond ≥ reconstruction_cost for that tier, and a
 *                      reputation discount can NEVER push below the floor
 *                      (the invariant bond > max_gain_from_sabotage).
 *   2. Accessibility — π must not price legitimate agents out. Encoded as
 *                      the reputation discount (a proven principal pays
 *                      meaningfully less for routine work) and the ceiling.
 *   3. Risk sensitivity — π increases with scope and criticality. Encoded
 *                      as the scope multiplier (read ≪ write ≪ critical ≪ full).
 *   4. History adjustment — π may decrease for strong track records.
 *                      Encoded as ρ(p), capped at r_max ≤ 0.5.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  SYBIL DEFENSE: KEY REPUTATION ON THE PRINCIPAL, NOT THE AGENT
 * ════════════════════════════════════════════════════════════════════════
 * Agent ids are cheap and re-rollable: "create identity, sabotage, discard"
 * (paper §3, the one-shot-defector adversary). If the reputation discount
 * were keyed on the agent id, an attacker would farm a clean history, then
 * spin up a FRESH agent id to dodge a deserved surcharge — or to inherit a
 * discount for free.
 *
 * So `reputation` is keyed on the PRINCIPAL / Anchor delegation identity
 * (ADR-0014 The Anchor Protocol; ADR-0022 durable actor souls). The Anchor
 * binds an identity to a hardware-rooted passkey credential, so shedding a
 * reputation by re-incarnating costs the per-identity onboarding cost
 * C_kyc, not zero (paper §6.4.2 "Persistent identity"). A fresh agent id
 * under the SAME principal therefore INHERITS that principal's reputation;
 * a brand-new principal gets the unknown-agent surcharge.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT IS REAL vs STUBBED
 * ════════════════════════════════════════════════════════════════════════
 *   • REAL: the closed-form floor, the scope/criticality classification
 *     from real signals (harbor-card `cap[]` grammar + Coast Guard crown
 *     jewels), the duration multiplier, the per-tier IC floors, the ceiling.
 *   • STUBBED: the reputation lookup. No reputation/quality-eval ledger
 *     exists yet (it is Proposed — the roadmap "reputation/quality-eval
 *     ledger spine"). Until it lands, `reputation` is an OPTIONAL hook; when
 *     absent, ρ = 0 (par, 1.0× — no free ride). This module never invents a
 *     history it cannot read.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  PURITY
 * ════════════════════════════════════════════════════════════════════════
 * This module is PURE: no I/O, no DB, no clock, no env reads. Every output
 * is a deterministic function of its input (the optional `reputation`
 * callback is the only injected effect, and it is the caller's job to make
 * it deterministic for a given principal). That makes the mechanism-design
 * properties — monotonicity, the deterrence floor, accessibility, Sybil
 * resistance, the ceiling clamp — fully unit-testable without a daemon.
 */

// ─── Scope: the capability grammar (lib/harbor-tokens.ts `cap[]`) ───────────────
//
// A harbor card carries `cap: string[]` (lib/harbor-tokens.ts). The capability
// grammar is defined in lib/cap-attenuation-monitor.ts (ADR-0027):
//   • exact caps: `spawn:agent`, `presence:write`, `backend:<id>`, …
//   • prefix caps: `chan:pub:<prefix>` / `chan:sub:<prefix>`, where `*`
//     dominates the verb.
// We classify a capability SET into one consequential-scope tier. The tiers
// mirror the mechanism-design decision tree (read 1× / write 3× / critical
// 10× / full|spawn 25×; see ScopeTier below) and the paper's s(F) signals
// ("files claimed, presence of db:write, production-deployment capability").

/** The consequential-scope tier of a Float Plan, coarsest signal first. */
export type ScopeTier = 'read' | 'write' | 'critical' | 'full';

/**
 * Scope multiplier (1 + α·s) per tier, from the mechanism-design decision
 * tree. Super-linear by construction — cleanup/coordination cost dominates
 * the high end (paper §6.5.2). These ARE the calibration targets the paper
 * says to tune from a deployment's own audit log; the defaults below are the
 * literature's starting bands.
 *
 *   read     ~1×   read-only access — minimal blast radius.
 *   write    ~3×   write to non-critical files.
 *   critical ~10×  write to crown-jewel / auth / config / DB-migration paths.
 *   full     ~25×  full-system access OR the right to spawn more agents
 *                  (a spawn cap is an amplifier: the bond must cover the
 *                  blast radius of the CHILDREN it can create).
 */
export const SCOPE_MULTIPLIER: Readonly<Record<ScopeTier, number>> = {
  read: 1,
  write: 3,
  critical: 10,
  full: 25,
};

/**
 * Per-tier DETERRENCE FLOOR, as a multiple of the cleanup base `c`. This is
 * the operational form of the Cleanup Lower Bound (π ≥ c) refined per threat
 * class: "Introduce a minimum bond floor tied to file criticality scores.
 * Critical files get 10x minimum regardless of agent history" (skill,
 * Failure Mode "Undercollateralization Spiral").
 *
 * The floor is what enforces the IC invariant `bond > max_gain_from_sabotage`
 * for the tier: a reputation discount applies to the (1 + α·s) curve but can
 * NEVER push the quoted bond below `floorMultiple × c`. The critical/full
 * tiers keep a high floor no matter how deep the discount.
 *
 *   read     1×c    a breach of read-only work still costs ≥ one cleanup unit.
 *   write    3×c    non-critical write reconstruction.
 *   critical 10×c   crown-jewel reconstruction dwarfs the bond; floor stays high.
 *   full     25×c   full / spawn blast radius; floor stays high.
 */
export const FLOOR_MULTIPLE: Readonly<Record<ScopeTier, number>> = {
  read: 1,
  write: 3,
  critical: 10,
  full: 25,
};

// ─── Duration multiplier (the bond/card TTL tree) ───────────────────────────────
//
// Longer access = more time to do damage, accrue spend, and drift from the
// plan. The duration tree is the mechanism-design skill's prescription
// (Task-Complexity-Proportional Bonds, DURATION branch):
//   < 10 min → 1.0×, 10–30 min → 1.5×, 30–60 min → 2.0×, > 60 min → 3.0×.

/** Duration multiplier for a bond/harbor-card TTL given in milliseconds. */
export function durationMultiplier(ttlMs: number): number {
  // Non-finite / non-positive TTL → treat as the shortest band (no amplification).
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 1.0;
  const minutes = ttlMs / 60_000;
  if (minutes <= 10) return 1.0;
  if (minutes <= 30) return 1.5;
  if (minutes <= 60) return 2.0;
  return 3.0;
}

// ─── Crown-jewel overlap → criticality escalation ───────────────────────────────
//
// lib/coast-guard.ts defines the crown jewels: `deniedDirs` (~/.ssh, ~/.aws,
// ~/.gnupg, ~/.config/gcloud, ~/.config/gh, ~/.kube, …) plus every dotenv
// (`.env` / `.env.local`). A plan that touches any of those is CRITICAL by
// construction (secret/key blast radius), regardless of read/write — matching
// the operator's framing that "any bash command has the power of a god who
// can bankrupt me" (ADR-0050).
//
// The signal here is a structural path-prefix test against caller-supplied
// crown-jewel roots — NOT keyword matching over free text. Callers pass the
// roots from `defaultCrownJewels().deniedDirs` + dotenv roots.

/**
 * Does any claimed path fall under (or name) a crown-jewel root, OR name a
 * dotenv file? A dotenv (`.env` / `.env.local`) is a crown jewel WHEREVER it
 * lives — the dotenv IS the operator's secret store (coast-guard.ts
 * `scrubRawSecretsFromEnv`) — so it is detected even with no roots passed.
 */
export function touchesCrownJewel(
  claimedPaths: readonly string[],
  crownJewelRoots: readonly string[],
): boolean {
  if (claimedPaths.length === 0) return false;
  for (const raw of claimedPaths) {
    const p = raw.trim();
    if (!p) continue;
    // Any dotenv file, regardless of roots (the dotenv IS the secret store).
    if (/(?:^|\/)\.env(?:$|\.)/.test(p)) return true;
    for (const rawRoot of crownJewelRoots) {
      const root = rawRoot.trim();
      if (!root) continue;
      // Exact match or subpath match (root + '/') against a denied dir.
      if (p === root) return true;
      if (p.startsWith(root.endsWith('/') ? root : root + '/')) return true;
    }
  }
  return false;
}

// ─── Capability classification ──────────────────────────────────────────────────

/**
 * Classify a harbor-card capability set + claimed paths into a consequential
 * scope tier. The TIER is the MAX over every signal — scope only widens, it
 * never narrows (an agent that can both read and spawn is priced as `full`).
 *
 * Signals, lowest → highest tier:
 *   • read-only caps (`*:read`, `read`, `fs:read`, `chan:sub:*`) → read.
 *   • write caps (`*:write`, `write`, `fs:write`, `chan:pub:*`) → write.
 *   • critical caps (`db:write`, `db:migrate`, `deploy`, `prod:*`, `secret:*`)
 *     OR a crown-jewel path overlap → critical.
 *   • full / amplifier caps (`*` / `full` / `admin`, or `spawn:agent` /
 *     `spawn:*` / `backend:*` — the right to create children) → full.
 */
export function classifyScope(
  capabilities: readonly string[],
  opts: { touchesCrownJewel?: boolean } = {},
): ScopeTier {
  // Rank tiers so we can take a max.
  const RANK: Record<ScopeTier, number> = { read: 0, write: 1, critical: 2, full: 3 };
  const TIERS: ScopeTier[] = ['read', 'write', 'critical', 'full'];
  let tier: ScopeTier = 'read';
  const raise = (t: ScopeTier): void => {
    if (RANK[t] > RANK[tier]) tier = t;
  };

  // Crown-jewel overlap is critical no matter what the caps say.
  if (opts.touchesCrownJewel) raise('critical');

  for (const rawCap of capabilities) {
    const cap = rawCap.trim().toLowerCase();
    if (!cap) continue;

    // FULL / amplifier: full-system access, admin, or the power to spawn.
    // A spawn or wildcard-backend cap is an amplifier — the bond must cover
    // the blast radius of the children it can create — so it tops the tier.
    if (
      cap === '*' || cap === 'full' || cap === 'admin' ||
      cap === 'spawn:agent' || cap.startsWith('spawn:') ||
      cap === 'backend:*' || cap.startsWith('backend:*')
    ) {
      raise('full');
      continue;
    }

    // CRITICAL: db writes/migrations, production deploys, secret access.
    if (
      cap.startsWith('db:write') || cap.startsWith('db:migrate') ||
      cap === 'db:*' ||
      cap.startsWith('deploy') || cap.startsWith('prod:') ||
      cap.startsWith('secret:') || cap.startsWith('kms:')
    ) {
      raise('critical');
      continue;
    }

    // WRITE: any write/publish capability.
    if (
      cap === 'write' || cap.endsWith(':write') ||
      cap.startsWith('fs:write') ||
      cap.startsWith('chan:pub:') ||
      cap.startsWith('presence:write')
    ) {
      raise('write');
      continue;
    }

    // READ (and everything unrecognized): the conservative floor tier.
    // Unknown caps do NOT silently escalate — escalation comes only from a
    // recognized higher-tier signal or a crown-jewel overlap, both explicit.
  }

  return tier;
}

// ─── Reputation ─────────────────────────────────────────────────────────────────

/** What the reputation hook returns for a principal. */
export interface ReputationRecord {
  /** Count of clean (successful) settlements under this PRINCIPAL. */
  completions: number;
  /** Fraction of settlements that breached/failed, in [0, 1]. */
  failureRate: number;
}

/**
 * Reputation lookup, keyed on the PRINCIPAL / Anchor delegation identity —
 * NOT the agent id (the Sybil defense; see module header). Returns null for
 * an unknown principal (→ unknown-agent surcharge). When the whole hook is
 * omitted, the pricer applies par (ρ = 0, 1.0×, no discount and no surcharge
 * beyond base) — there is no reputation ledger to read yet.
 */
export type ReputationLookup = (principalId: string) => ReputationRecord | null;

/** Reputation discount cap. Paper §6.5.3: ρ ∈ [0, r_max], r_max ≤ 0.5. */
export const R_MAX = 0.5;

/**
 * The reputation FACTOR (1 − ρ) and a human-readable discount fraction ρ,
 * from a principal's history. This is the discrete tier table from the
 * mechanism-design skill (Reputation-Adjusted Bonds), expressed as the
 * paper's multiplicative (1 − ρ) form and clamped to r_max:
 *
 *   unknown principal (no record)        → 2.0× surcharge   (factor 2.0)
 *   1–5 completions, 0 failures          → 1.5× surcharge   (factor 1.5)
 *   5–20 completions, <10% failure       → par              (factor 1.0)
 *   20–50 completions, <5% failure       → 0.7× (ρ = 0.30)  (factor 0.7)
 *   50+ completions, <3% failure         → 0.5× (ρ = 0.50)  (factor 0.5, = r_max)
 *   ANY principal with >20% failure rate → 3.0× penalty     (factor 3.0)
 *
 * NOTE the asymmetry: the discount side is clamped to (1 − r_max) = 0.5× so a
 * deep history can never trivialize the bond. The SURCHARGE side (>1.0×) is
 * deliberately uncapped here — pricing an unknown or failing principal UP is
 * accessibility-safe (it only raises their cost) and is the screening signal
 * against adverse selection. `ρ` in the breakdown reports the discount
 * fraction in [0, r_max]; for a surcharge it reports 0 (no discount applied).
 */
export function reputationFactor(
  rec: ReputationRecord | null,
): { factor: number; rho: number } {
  // Unknown principal — surcharge. A brand-new principal pays MORE, never less.
  if (!rec) return { factor: 2.0, rho: 0 };

  const completions = Number.isFinite(rec.completions) ? Math.max(0, rec.completions) : 0;
  const failureRate = Number.isFinite(rec.failureRate)
    ? Math.min(1, Math.max(0, rec.failureRate))
    : 1;

  // A bad track record is a penalty regardless of volume.
  if (failureRate > 0.2) return { factor: 3.0, rho: 0 };

  // Discounts: monotone in clean history, clamped to r_max.
  if (completions >= 50 && failureRate < 0.03) return { factor: 1 - R_MAX, rho: R_MAX }; // 0.5×
  if (completions >= 20 && failureRate < 0.05) return { factor: 0.7, rho: 0.3 };
  if (completions >= 5 && failureRate < 0.1) return { factor: 1.0, rho: 0 };             // par
  if (completions >= 1 && failureRate === 0) return { factor: 1.5, rho: 0 };             // mild surcharge

  // Known principal, but thin/mixed history that fits no discount band → par-ish
  // surcharge (still > par; they have not earned a discount).
  return { factor: 1.5, rho: 0 };
}

// ─── The pricer ─────────────────────────────────────────────────────────────────

export interface PriceBondInput {
  /**
   * Cleanup cost lower bound `c` (USD) — the human-plus-compute cost to
   * detect, assess, and recover from one breach for this project (paper
   * §6.5.1, observable from the audit log; rises = project fraying). This is
   * the `base` of the closed form. Must be a positive finite number.
   */
  baseUsd: number;
  /**
   * Harbor-card capability set (`cap[]` from lib/harbor-tokens.ts). Drives
   * the scope multiplier via classifyScope().
   */
  capabilities: readonly string[];
  /** Bond / harbor-card TTL in milliseconds. Drives the duration multiplier. */
  ttlMs: number;
  /**
   * The PRINCIPAL / Anchor delegation identity for the reputation lookup —
   * NOT the re-rollable agent id (Sybil defense). When omitted, reputation is
   * skipped (par).
   */
  principalId?: string;
  /**
   * Optional reputation lookup, keyed on principalId. Absent → par (1.0×, no
   * discount). Stubbed until the reputation ledger lands (roadmap item).
   */
  reputation?: ReputationLookup;
  /**
   * Paths the plan claims (files, dirs). Used ONLY for crown-jewel overlap
   * detection (criticality escalation). Optional.
   */
  claimedPaths?: readonly string[];
  /**
   * Crown-jewel roots from lib/coast-guard.ts `defaultCrownJewels().deniedDirs`
   * (+ dotenv roots). A claimed path under any of these forces the `critical`
   * tier. Optional; without it, only capability strings classify scope.
   */
  crownJewelRoots?: readonly string[];
  /**
   * Hard ceiling (USD) — the quoted bond is clamped to at most this. The
   * accessibility guarantee: a capable-but-capital-constrained principal must
   * be able to afford routine work. Maps to `escrow({ ceilingUsd })`. Optional.
   */
  ceilingUsd?: number;
  /**
   * Pre-classified scope tier, when the caller has already resolved it. When
   * provided it OVERRIDES capability/crown-jewel classification (used by tests
   * and by callers that compute scope upstream). Optional.
   */
  scopeTier?: ScopeTier;
}

export interface PricedBondBreakdown {
  /** Cleanup base `c` (USD) the curve was computed from. */
  base: number;
  /** The resolved consequential-scope tier. */
  scopeTier: ScopeTier;
  /** (1 + α·s) for the tier — the scope multiplier actually applied. */
  scopeMultiplier: number;
  /** Duration multiplier for the TTL. */
  durationMultiplier: number;
  /**
   * The reputation discount FRACTION ρ in [0, r_max] (0 when a surcharge or
   * par applied). The (1 − ρ) form of the paper's history adjustment.
   */
  reputationDiscount: number;
  /**
   * The full reputation FACTOR actually multiplied in (1 − ρ for a discount,
   * or > 1 for an unknown/failing principal). Exposed so the math reconciles:
   * base × scopeMultiplier × durationMultiplier × reputationFactor, then the
   * floor and ceiling clamps.
   */
  reputationFactor: number;
  /** Per-tier deterrence floor (USD) that was enforced (floorMultiple × base). */
  floorUsd: number;
  /** True iff the floor raised the bond above the reputation-adjusted curve. */
  floorApplied: boolean;
  /** True iff the ceiling clamped the bond down. */
  ceilingApplied: boolean;
}

export interface PricedBond {
  /** The bond amount to pass to `bonds.escrow({ bondUsd })`. */
  bondUsd: number;
  /** The full math, so callers / the Uite can show their work. */
  breakdown: PricedBondBreakdown;
}

/**
 * Price a bond from a Float Plan's scope, duration, and the principal's
 * reputation — the closed-form floor π(F, p) = c·(1 + α·s)·(1 − ρ), with a
 * per-tier deterrence floor (IC) and a ceiling clamp (accessibility).
 *
 * Order of operations (load-bearing for the invariants):
 *   1. curve   = base × scopeMultiplier(tier) × durationMultiplier(ttl)
 *   2. priced  = curve × reputationFactor(principal)      // §6.5.3
 *   3. floored = max(priced, floorMultiple(tier) × base)  // §6.5.1 IC floor
 *                  ← the discount can never breach the floor
 *   4. final   = min(floored, ceilingUsd)                 // accessibility clamp
 *
 * The floor is applied AFTER the reputation discount and BEFORE the ceiling:
 * deterrence dominates reputation, and the operator's affordability ceiling
 * dominates everything (a ceiling below a critical floor is the operator
 * explicitly choosing not to authorize that work at that price — the caller
 * sees ceilingApplied and the still-high floorUsd and can refuse).
 *
 * @example
 *   const { bondUsd, breakdown } = priceBond({
 *     baseUsd: 5,                              // c: one operator-hour
 *     capabilities: ['db:write', 'fs:write'],  // → critical tier
 *     ttlMs: 45 * 60_000,                      // 45 min → 2.0×
 *     principalId: 'anchor:erich',
 *     reputation: (p) => p === 'anchor:erich' ? { completions: 60, failureRate: 0.01 } : null,
 *     ceilingUsd: 200,
 *   });
 *   // bondUsd = max(5 × 10 × 2.0 × 0.5, 10 × 5) = max(50, 50) = 50, ≤ 200.
 */
export function priceBond(input: PriceBondInput): PricedBond {
  const {
    baseUsd,
    capabilities = [],
    ttlMs,
    principalId,
    reputation,
    claimedPaths = [],
    crownJewelRoots = [],
    ceilingUsd,
    scopeTier: scopeTierOverride,
  } = input;

  if (!Number.isFinite(baseUsd) || baseUsd <= 0) {
    throw new Error(
      `bond-pricing.priceBond: baseUsd (cleanup lower bound c) must be a positive finite number, got ${baseUsd}`,
    );
  }
  if (ceilingUsd !== undefined && (!Number.isFinite(ceilingUsd) || ceilingUsd < 0)) {
    throw new Error(
      `bond-pricing.priceBond: ceilingUsd must be a non-negative finite number when provided, got ${ceilingUsd}`,
    );
  }

  // ── Scope (s) → multiplier (1 + α·s) ──────────────────────────────────────
  const crownJewelOverlap = touchesCrownJewel(claimedPaths, crownJewelRoots);
  const scopeTier: ScopeTier =
    scopeTierOverride ?? classifyScope(capabilities, { touchesCrownJewel: crownJewelOverlap });
  const scopeMult = SCOPE_MULTIPLIER[scopeTier];

  // ── Duration ──────────────────────────────────────────────────────────────
  const durMult = durationMultiplier(ttlMs);

  // ── The risk curve, pre-reputation: c · (1 + α·s) · durationMultiplier ──────
  const curveUsd = baseUsd * scopeMult * durMult;

  // ── Reputation (1 − ρ), keyed on the PRINCIPAL ──────────────────────────────
  // No principal or no hook → par (factor 1.0, ρ 0): no free ride, no surcharge
  // beyond the curve. A hook that returns null for a known-id principal → the
  // unknown-agent surcharge (a fresh principal pays more).
  let repFactor = 1.0;
  let rho = 0;
  if (reputation && principalId !== undefined) {
    const rec = reputation(principalId);
    const r = reputationFactor(rec);
    repFactor = r.factor;
    rho = r.rho;
  }
  const pricedUsd = curveUsd * repFactor;

  // ── IC FLOOR (deterrence): bond ≥ floorMultiple(tier) × c ───────────────────
  // The reputation discount can NEVER push the bond below the per-tier
  // reconstruction-cost floor. Crown-jewel/critical & full tiers keep a high
  // floor regardless of how deep the principal's discount runs. This is the
  // operational form of `bond > max_gain_from_sabotage`.
  const floorUsd = FLOOR_MULTIPLE[scopeTier] * baseUsd;
  const flooredUsd = Math.max(pricedUsd, floorUsd);
  const floorApplied = flooredUsd > pricedUsd + 1e-12;

  // ── CEILING (accessibility): clamp down to the operator's affordability cap ──
  let finalUsd = flooredUsd;
  let ceilingApplied = false;
  if (ceilingUsd !== undefined && finalUsd > ceilingUsd) {
    finalUsd = ceilingUsd;
    ceilingApplied = true;
  }

  return {
    bondUsd: finalUsd,
    breakdown: {
      base: baseUsd,
      scopeTier,
      scopeMultiplier: scopeMult,
      durationMultiplier: durMult,
      reputationDiscount: rho,
      reputationFactor: repFactor,
      floorUsd,
      floorApplied,
      ceilingApplied,
    },
  };
}
