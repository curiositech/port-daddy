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
 * Daddy from Fixed Bonds to a **complexity-proportional** pricer. Its core is
 * the closed-form floor from the Bonded Commons paper, Chapter VI
 * (`whitepaper/source/agent-transactions-whitepaper.tex`,
 * §6.5 "Pricing the Bond", line 763/771):
 *
 *     π(F, p) = c · (1 + α · s(F)) · (1 − ρ(p))           [§6.5 closed form]
 *
 * IMPLEMENTED ≠ TRANSCRIBED — read this before trusting the "matches §6.5"
 * claim. The shipped quote is the §6.5 closed form with TWO deliberate
 * EXTENSIONS that are NOT in the paper's three-term product, plus the IC floor
 * and ceiling the paper enumerates as properties:
 *   (E1) a DURATION multiplier (the bond/card TTL tree, 1.0–3.0×). The paper's
 *        closed form has NO time term; duration comes from the mechanism-design
 *        skill (longer access ⇒ more time to drift/accrue/damage). It is folded
 *        in as an extra factor: c·(1+α·s)·duration·repFactor.
 *   (E2) a reputation SURCHARGE side (factors > 1.0 for unknown/failing
 *        principals). The paper's ρ ∈ [0, r_max] is a DISCOUNT only; the
 *        surcharge is an accessibility-safe screening extension (see
 *        reputationFactor() below for the full justification).
 * So the faithful statement is: "core formula from §6.5, extended with a
 * duration factor and a reputation surcharge, clamped by the §6.5 IC floor
 * (π ≥ c, refined per tier) and a ceiling." Do not cite this as a verbatim
 * implementation of the three-term product.
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
 *  PRICING IS NOT CONTAINMENT (read this before trusting the IC floor)
 * ════════════════════════════════════════════════════════════════════════
 * This module PRICES scope; it does not ENFORCE it. The per-tier floor proves
 * `bond ≥ reconstruction_cost` for the priced tier, but that IC argument only
 * deters real damage if the agent is actually BOUNDED to the scope it was
 * priced for. Two things must hold for the floor to mean what it says:
 *   1. The `capabilities` handed in must be the ATTENUATED card the agent
 *      truly carries — not a caller's wish. If a caller under-declares caps
 *      (prices `read`, acts `full`) the bond is too cheap for the damage done.
 *      In the spawn path this holds because the spawner prices the SAME cap set
 *      it enters the harbor with (lib/spawner.ts); a future caller that lets
 *      untrusted input pick `capabilities` reopens the gap. The HTTP/MCP spawn
 *      route does NOT accept a caller `bondUsd` or `capabilities`, so the
 *      bypass is in-process (SDK) only.
 *   2. The OS must hold the agent to the priced tier. Historically the Coast
 *      Guard (lib/coast-guard.ts, ADR-0050) only denied crown-jewel READS +
 *      capped egress — it did NOT deny WRITES by tier, so a `read`-priced agent
 *      could still write the project. PR #339 closes the highest-value half of
 *      that gap: a `read`-tier spawn can now be confined to DENY writes to the
 *      project workdir (the shared state the bond protects) via the Coast
 *      Guard's `writePolicy` (macOS Seatbelt enforced; Linux bwrap ro-bind;
 *      `none` reported honestly). It is OPT-IN and does not change the default
 *      `full`-tier spawn. It is NOT a claim of full read-only-everywhere
 *      isolation, nor of malicious-same-UID resistance — those remain ADR-0050
 *      phase 4 (separate UID/VM). See `scopeTierWritePolicy()` below.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT IS REAL vs STUBBED
 * ════════════════════════════════════════════════════════════════════════
 *   • REAL: the closed-form floor, the scope/criticality classification
 *     from real signals (harbor-card `cap[]` grammar + Coast Guard crown
 *     jewels), the duration multiplier, the per-tier IC floors, the ceiling,
 *     the `belowFloor` undercollateralization signal, and the read-tier
 *     write-confinement mapping (`scopeTierWritePolicy`, enforced by the Coast
 *     Guard on macOS; honest degraded report elsewhere).
 *   • STUBBED: the reputation lookup. No reputation/quality-eval ledger
 *     exists yet (it is Proposed — the roadmap "reputation/quality-eval
 *     ledger spine"). Until it lands, `reputation` is an OPTIONAL hook; when
 *     absent, ρ = 0 (par, 1.0× — no free ride). This module never invents a
 *     history it cannot read.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  CONTAINMENT CAVEAT — priceBond PRICES scope, it does NOT ENFORCE it
 * ════════════════════════════════════════════════════════════════════════
 * priceBond PRICES the capability card it is handed; it does NOT enforce
 * scope. The `cap[]` it classifies is ADVISORY — nothing here gates what the
 * spawned agent can actually do. Hard containment today is ONLY the Coast
 * Guard (lib/coast-guard.ts: crown-jewel read-deny + egress cap), and the
 * Coast Guard does NOT write-gate by priced tier — a `read`-priced and a
 * `critical`-priced agent face the same Coast-Guard-bounded blast radius.
 *
 * So the IC property `bond > max_gain_from_sabotage` holds against the
 * COAST-GUARD-bounded blast radius, NOT against the priced tier. A bond
 * priced `critical` buys deterrence proportional to what the Coast Guard
 * still lets through, not proportional to a tier the runtime enforces.
 * Bond↔Coast-Guard write-gating (slash/refuse a write the bond did not cover)
 * is the UNBUILT Layer-1 enforcement, tracked separately. Read every quote
 * from this module as "priced against the Coast Guard's blast radius."
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

// The bond↔Coast-Guard scope-containment linker. `enforcedContainmentTier` is a
// PURE function (deterministic over a CoastGuardStatusReport — no I/O), so
// importing it preserves this module's purity invariant. CYCLE-SAFETY: this is
// the ONLY runtime import edge between the two modules — coast-guard.ts imports
// from bond-pricing.ts with `import type` ONLY (the ScopeTier vocabulary), fully
// erased at compile time → NO runtime edge. So the runtime graph is a single
// edge bond-pricing → coast-guard, not a cycle.
import { enforcedContainmentTier, type CoastGuardStatusReport } from './coast-guard.js';

// ─── Scope: the capability grammar (lib/harbor-tokens.ts `cap[]`) ───────────────
//
// A harbor card carries `cap: string[]` (lib/harbor-tokens.ts). The capability
// grammar ENFORCED TODAY is defined in lib/cap-attenuation-monitor.ts (ADR-0027)
// and is deliberately small:
//   • exact caps: `spawn:agent`, `presence:write`, `backend:<id>` (covered
//     only by an identical parent cap);
//   • prefix caps: `chan:pub:<prefix>` / `chan:sub:<prefix>`, where `*` at the
//     value position dominates the verb.
//
// classifyScope() ALSO recognizes a WIDER vocabulary — `fs:read` / `fs:write`,
// `db:write` / `db:migrate`, `deploy*` / `prod:*`, `secret:*` / `kms:*`,
// `*` / `full` / `admin`. Those forms are the paper's s(F) signals ("files
// claimed, presence of db:write, production-deployment capability", §6.5.2) and
// the worked example's card (`fs:read:repo`, `fs:write:auth.ts`, `cmd:test`,
// §VI appendix) — i.e. they are FORWARD-LOOKING. Most are NOT yet minted by
// lib/harbor-tokens.ts, so today the only caps a real spawn carries are
// `spawn:agent` + `backend:<id>` (→ the `full` tier). The wider table is here so
// the pricer is correct the day those caps ship; it never invents scope from an
// UNRECOGNIZED cap (unknown → the conservative `read` floor — see classifyScope).
// We classify a capability SET into one consequential-scope tier (read 1× /
// write 3× / critical 10× / full|spawn 25×; see ScopeTier below).

/** The consequential-scope tier of a Float Plan, coarsest signal first. */
export type ScopeTier = 'read' | 'write' | 'critical' | 'full';

/**
 * Total order on scope tiers (read ≺ write ≺ critical ≺ full). The single
 * exported source of truth for "tier A exceeds tier B" — used by the
 * priced-vs-enforced comparison that drives `uncontainedScope`. Higher number =
 * wider blast radius. (classifyScope keeps its own local copy for the
 * max-over-signals; this is the public ordering for cross-module comparisons.)
 */
export const TIER_RANK: Readonly<Record<ScopeTier, number>> = {
  read: 0,
  write: 1,
  critical: 2,
  full: 3,
};

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

// ─── Scope tier → OS write policy (pricing ⇄ containment bridge) ─────────────────
//
// The pricing tier is only an HONEST deterrent if the OS holds the agent to the
// scope it was priced for (see "PRICING IS NOT CONTAINMENT" in the header). This
// is the one place that maps a priced tier to a CONTAINMENT posture the Coast
// Guard (lib/coast-guard.ts) can enforce. Today it is binary: a `read`-tier card
// gets a read-only confinement (it physically cannot WRITE the project workdir —
// the shared state the bond protects); every higher tier is `unrestricted`
// (writes are allowed because the bond is sized to cover the write blast radius).
//
// This is deliberately CONSERVATIVE on two axes, and we say so:
//   • It governs WRITES to the project workdir only — not all writes everywhere
//     (a read-tier agent can still write /tmp, its own scratch). The bond
//     protects shared PROJECT state; that is what we deny writing.
//   • `read-only` is enforced by the macOS Seatbelt profile and the Linux bwrap
//     ro-bind; where no OS sandbox exists the Coast Guard reports `confined:
//     false` and the policy is advisory only. It is NOT malicious-same-UID
//     proof (ADR-0050 phase 4 — separate UID/VM — is the answer to that).

/** What writes a confined agent of a given scope tier may perform. */
export type WritePolicy = 'read-only' | 'unrestricted';

/**
 * Map a priced scope tier to the Coast Guard write policy that ENFORCES it.
 * `read` → `read-only` (deny writes to the project workdir); every higher tier
 * (`write`/`critical`/`full`) → `unrestricted` (the bond covers the write blast
 * radius, so writing the project is the point of the work).
 */
export function scopeTierWritePolicy(tier: ScopeTier): WritePolicy {
  return tier === 'read' ? 'read-only' : 'unrestricted';
}

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

// ⚠ CAP VOCABULARY IS FORWARD-LOOKING. Today's REAL ADR-0027 capability grammar
// (the emitter is lib/cap-attenuation-monitor.ts) only implements these caps:
//   spawn:agent, backend:<id>, presence:write, chan:pub:*, chan:sub:*.
// The OTHER caps this classifier recognizes — db:write, deploy, prod:*, secret:*,
// fs:* — are the PAPER's conceptual grammar (§6.5.2 s(F) signals) and are NOT YET
// emitted by any real harbor card. Consequence: a real priced spawn today carries
// only `spawn:agent` + `backend:<id>`, so it classifies as `full` (25×) every time
// — the critical/write/read tiers below are exercised by tests and by upstream
// callers that pass an explicit `scopeTier`, but will not fire from live cap[]
// strings until the grammar grows. This classifier is wired ahead of the grammar
// on purpose (so pricing is correct the day those caps land), not dead code.

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
    // NOTE: an EXACT `backend:<id>` (e.g. `backend:ollama`) is NOT an amplifier
    // (it grants ONE provider, not the power to spawn), so only the wildcard
    // `backend:*` escalates here — `backend:ollama` falls through to `read`.
    if (
      cap === '*' || cap === 'full' || cap === 'admin' ||
      cap.startsWith('spawn:') ||
      cap === 'backend:*'
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
 * mechanism-design skill (Reputation-Adjusted Bonds).
 *
 * IMPORTANT — this is an EXTENSION of paper §6.5.3, not a literal transcription
 * of it. The paper's history adjustment is `(1 − ρ), ρ ∈ [0, r_max], r_max ≤ 0.5`
 * — i.e. strictly a DISCOUNT: the factor lives in [0.5, 1.0] and can only ever
 * LOWER the bond. This table keeps that discount side faithfully (clamped to
 * 1 − r_max = 0.5×) but ALSO adds a SURCHARGE side (factors > 1.0) for unknown,
 * thin, or failing principals. A surcharge has `ρ < 0`, which is OUTSIDE the
 * paper's stated domain; we add it deliberately because pricing a bad/unknown
 * risk UP is accessibility-safe (it only raises THEIR cost, never a legitimate
 * agent's) and is the screening signal against adverse selection (the paper's
 * own Property 2). The breakdown reports `reputationDiscount = ρ ∈ [0, r_max]`
 * for the discount/par cases and `0` for a surcharge; the full multiplicative
 * `reputationFactor` (which may exceed 1) is reported separately so the math
 * reconciles.
 *
 * Predicates are evaluated TOP-DOWN; boundaries are exactly as coded —
 * failure-rate cutoffs are STRICT `<` / `>` (never `≥` / `≤`), completion
 * cutoffs are inclusive `≥`, so a value sitting exactly on a cutoff falls to
 * the NEXT-lower band:
 *
 *   unknown principal (no record)                 → 2.0× surcharge  (factor 2.0)
 *   failureRate > 0.20 (any volume)               → 3.0× penalty    (factor 3.0)
 *   completions ≥ 50  AND failureRate < 0.03      → 0.5× discount   (factor 0.5 = 1 − r_max)
 *   completions ≥ 20  AND failureRate < 0.05      → 0.7× discount   (factor 0.7, ρ = 0.30)
 *   completions ≥ 5   AND failureRate < 0.10      → par             (factor 1.0)
 *   completions ≥ 1   AND failureRate == 0        → 1.5× surcharge  (factor 1.5)
 *   otherwise (thin/mixed history, no band fits)  → 1.5× surcharge  (factor 1.5)
 *
 * Boundary examples: failureRate of EXACTLY 0.05 fails `< 0.05` → falls to par
 * (1.0×); failureRate of EXACTLY 0.20 fails `> 0.20` and (with no qualifying
 * discount band) lands at the 1.5× surcharge, NOT the 3.0× penalty.
 *
 * NOTE the asymmetry: the discount side is clamped to (1 − r_max) = 0.5× so a
 * deep history can never trivialize the bond; the surcharge side is uncapped.
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
  /**
   * Optional Coast Guard status report (lib/coast-guard.ts `CoastGuardStatusReport`,
   * via `coastGuardStatus()`) describing what the platform STRUCTURALLY contains
   * on this machine today. When supplied, the pricer compares the tier it PRICED
   * against the tier the Coast Guard actually ENFORCES (`enforcedContainmentTier`)
   * and sets `breakdown.uncontainedScope = true` when the priced tier exceeds it —
   * surfacing the structural gap where the bond underwrites damage the platform
   * cannot prevent (see `breakdown.uncontainedScope`).
   *
   * ADVISORY ONLY. This changes NO escrow, NO floor, NO ceiling, NO bondUsd, and
   * refuses nothing — it only sets a flag. ABSENT → the flag stays `false` (no
   * Coast Guard posture to read; the pricer never fabricates a containment claim
   * it cannot ground). Optional.
   */
  coastGuardReport?: CoastGuardStatusReport;
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
  /** Per-tier deterrence floor (USD) — the IC minimum (floorMultiple × base). */
  floorUsd: number;
  /** True iff the floor raised the bond above the reputation-adjusted curve. */
  floorApplied: boolean;
  /** True iff the ceiling clamped the bond down. */
  ceilingApplied: boolean;
  /**
   * True iff the ceiling clamp pushed the quoted bond BELOW the per-tier
   * deterrence floor — i.e. `ceilingApplied && bondUsd < floorUsd`. This is the
   * ceiling-breaches-floor signal: the operator's affordability ceiling sat
   * under the tier's reconstruction-cost floor, so the IC invariant
   * `bond > max_gain_from_sabotage` does NOT hold for this quote. The pricer
   * does NOT throw or re-clamp (the operator may have deliberately set a low
   * ceiling); it flags, and the CALLER decides whether to escrow, refuse, or
   * narrow scope. Consuming `bondUsd` while `belowFloor === true` escrows an
   * UNDERCOLLATERALIZED bond and MUST be gated on this flag.
   */
  belowFloor: boolean;
  /**
   * True iff the PRICED scope tier EXCEEDS the tier the Coast Guard actually
   * CONTAINS on this machine today — i.e. the bond prices risk the platform
   * cannot structurally contain. This is the bond↔Coast-Guard scope-containment
   * gap, surfaced economically: the pricer charges proportional to a `critical`/
   * `full` blast radius while the runtime (lib/coast-guard.ts) contains only the
   * read/exfil/spend axis + the read-tier workdir write-deny
   * (`enforcedContainmentTier` returns the honest MODEST ceiling `'read'`, or
   * `null` when no sandbox). `scopeTierWritePolicy` leaves write/critical/full
   * `unrestricted` by design, so for those tiers the bond's IC deterrence covers
   * damage the platform CANNOT actually prevent — economics carrying weight the
   * STRUCTURE should.
   *
   * Computed ONLY when `coastGuardReport` is supplied; ABSENT input → stays
   * `false` (no posture to read — the pricer never fabricates a containment
   * claim). Like `belowFloor`, this is ADVISORY: the pricer does NOT throw,
   * re-clamp, or refuse (a hard write-gate on a core primitive is unbuilt
   * Layer-1 enforcement needing separate operator sign-off, tracked separately).
   * It flags; the CALLER decides whether to escrow anyway, narrow the priced
   * scope, or wait for real containment. Consuming `bondUsd` while
   * `uncontainedScope === true` escrows a bond whose deterrence the runtime
   * cannot back with enforcement — the bond is sound, the CONTAINMENT is not.
   */
  uncontainedScope: boolean;
  /**
   * The tier the Coast Guard ACTUALLY contains on this machine, as
   * `enforcedContainmentTier(coastGuardReport)` returned it — the honest counter-
   * party to `scopeTier` in the `uncontainedScope` comparison. Surfaced so a
   * caller (and `pricedBondLogLines`) can tell the two KINDS of uncontainment
   * apart, which carry very different operator urgency:
   *   • a present-but-MODEST tier (today honestly `'read'` under an armed
   *     sandbox) — the EXPECTED steady state. The default `full`-tier spawn
   *     exceeds `'read'`, so ~100% of priced spawns are "uncontained" in this
   *     benign, KNOWN sense (the documented pricing-ahead-of-containment gap). An
   *     always-on WARN here is alarm-fatigue, not signal → log at INFO.
   *   • `null` — DEGRADED: no OS sandbox, the guard is off, or a core bound is
   *     missing. NOTHING is structurally contained, so the spawn is truly
   *     unconfined. THIS is the actionable anomaly → log at WARN.
   *
   * `undefined` when no `coastGuardReport` was supplied (no posture was read —
   * `uncontainedScope` is then `false` and there is nothing to compare). This
   * field is pure metadata: it changes no escrow, no `bondUsd`, and does NOT
   * alter the `uncontainedScope` flag's value — it only lets the caller choose
   * the right LOG LEVEL for an uncontained quote.
   */
  enforcedScopeTier?: ScopeTier | null;
}

export interface PricedBond {
  /** The bond amount to pass to `bonds.escrow({ bondUsd })`. */
  bondUsd: number;
  /** The full math, so callers / the UI can show their work. */
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
 * ⚠ CEILING-BREACHES-FLOOR. When `ceilingUsd < floorMultiple(tier)·c`, the
 * ceiling clamp wins and `bondUsd` lands BELOW the tier's deterrence floor —
 * the IC invariant `bond > max_gain_from_sabotage` does NOT hold for that
 * quote. `priceBond` does NOT throw or re-clamp (the low ceiling may be
 * deliberate); it sets `breakdown.belowFloor = true`. A caller that escrows
 * `bondUsd` WITHOUT checking `breakdown.belowFloor` can escrow an
 * UNDERCOLLATERALIZED bond. Inspect `breakdown.belowFloor` and refuse, narrow
 * scope, or raise the ceiling before escrowing.
 *
 * ⚠ UNCONTAINED-SCOPE. When the optional `coastGuardReport` is supplied and the
 * PRICED tier exceeds the tier the Coast Guard actually CONTAINS today
 * (lib/coast-guard.ts `enforcedContainmentTier` — honestly only `'read'` with a
 * sandbox, `null` without), `priceBond` sets `breakdown.uncontainedScope = true`.
 * The bond then prices a blast radius the runtime cannot structurally prevent
 * (write/critical/full tiers are `unrestricted` under `scopeTierWritePolicy`; no
 * force-push gate) — its IC deterrence is sound but UNBACKED by enforcement. Like
 * `belowFloor`, this is ADVISORY: `priceBond` does NOT throw, re-clamp, or refuse
 * (a hard write-gate is unbuilt Layer-1 enforcement needing separate operator
 * sign-off). Inspect `breakdown.uncontainedScope` and decide to escrow anyway,
 * narrow the priced scope, or wait for real containment. ABSENT report → the
 * flag stays `false`.
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
    coastGuardReport,
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
  // The ceiling dominates EVERYTHING, including the IC floor: a ceiling set below
  // a tier's reconstruction-cost floor is the operator explicitly declining to
  // collateralize that work at that price. We honor it — but we do NOT pretend
  // the floor held. `belowFloor` (below) makes the breach explicit so no caller
  // can silently escrow an undercollateralized bond.
  let finalUsd = flooredUsd;
  let ceilingApplied = false;
  if (ceilingUsd !== undefined && finalUsd > ceilingUsd) {
    finalUsd = ceilingUsd;
    ceilingApplied = true;
  }

  // ── CEILING-BREACHES-FLOOR: a ceiling below the tier floor wins the clamp and
  // lands the bond UNDER its deterrence floor — the IC invariant no longer holds.
  // We do not re-clamp or throw (the operator may have set the low ceiling on
  // purpose); we surface the breach so the caller can refuse / narrow scope.
  // (1e-9 float tolerance; only the ceiling clamp can produce this — without a
  // ceiling, finalUsd == flooredUsd ≥ floorUsd.)
  const belowFloor = ceilingApplied && finalUsd < floorUsd - 1e-9;

  // ── UNCONTAINED SCOPE: the bond↔Coast-Guard scope-containment gap ────────────
  // When a Coast Guard report is supplied, compare the tier we PRICED against the
  // tier the platform actually CONTAINS today (lib/coast-guard.ts
  // `enforcedContainmentTier`). If priced > enforced, the bond underwrites a
  // blast radius the runtime cannot structurally prevent — flag it. ADVISORY: no
  // throw, no re-clamp, no refusal (a hard write-gate is unbuilt Layer-1
  // enforcement, separate operator sign-off). ABSENT report → stays false (no
  // posture to read; never fabricate a containment claim). A `null` enforced tier
  // (DEGRADED — no sandbox) means NOTHING is contained, so ANY priced tier
  // (including `read`) is uncontained.
  // `enforcedScopeTier` (below) carries the enforced side of this comparison out
  // to the caller so it can tell a MODEST-but-present tier (benign steady-state
  // gap → INFO) apart from `null` (degraded, truly unconfined → WARN) without
  // re-deriving it. `undefined` when no report was read.
  let uncontainedScope = false;
  let enforcedScopeTier: ScopeTier | null | undefined;
  if (coastGuardReport !== undefined) {
    const enforcedTier = enforcedContainmentTier(coastGuardReport);
    enforcedScopeTier = enforcedTier;
    uncontainedScope =
      enforcedTier === null
        ? true // degraded posture contains no tier at all → any priced scope is uncontained
        : TIER_RANK[scopeTier] > TIER_RANK[enforcedTier];
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
      belowFloor,
      uncontainedScope,
      enforcedScopeTier,
    },
  };
}

// ─── Operator log lines (PURE — formatting only, no I/O) ─────────────────────────
//
// A caller that escrows a priced bond (lib/spawner.ts) wants OPERATOR VISIBILITY:
// the chosen tier + the multipliers that produced it + the final amount, an
// informative line when the priced tier outruns a present-but-modest enforced
// tier (the KNOWN, benign pricing-ahead-of-containment gap), and a LOUD warning
// only for the ACTIONABLE anomalies — an undercollateralized quote (`belowFloor`)
// or a TRULY UNCONFINED spawn (no OS sandbox at all → enforced tier is `null`).
// This is the one place that turns a `PricedBondBreakdown` into those human
// strings. It is kept PURE (returns strings; the caller does the console I/O) so
// the exact log text AND the level-routing conditions are unit-testable without a
// daemon, and so this module keeps its "no I/O" invariant. The caller routes
// `info` + every `notices` entry → its info/log sink and every `warnings` entry →
// its warn sink.
//
// WHY THE SPLIT (alarm fatigue is a regression). `scopeTierWritePolicy` leaves
// every tier above `read` `unrestricted`, so the enforced ceiling is honestly
// `'read'` even under an armed sandbox (lib/coast-guard.ts `enforcedContainmentTier`).
// The DEFAULT spawn prices `full`. So `uncontainedScope` is true on ~100% of
// full-tier spawns whenever the guard is armed — the EXPECTED steady state, not
// an incident. Emitting that at WARN buries the one case that IS an incident
// (`enforcedScopeTier === null`: no sandbox, guard off, or a core bound missing →
// the spawn is structurally unconfined). So: present-but-modest enforced tier →
// INFO notice; `null` enforced tier → WARN. The `uncontainedScope` flag value is
// unchanged — this is purely the operator-facing LOG LEVEL.

/** Context for a priced-bond log line — who/what the bond is for. */
export interface PricedBondLogContext {
  /** The bond amount actually escrowed (post floor/ceiling). */
  bondUsd: number;
  /** A short identifier for the bonded subject (e.g. the agent id). Optional. */
  agentId?: string;
  /** The backend / archetype the bond is for (e.g. 'claude-cli'). Optional. */
  backend?: string;
}

/**
 * Render the operator-facing log lines for a priced bond:
 *   • `info`     — one always-present line with the tier + every multiplier + the
 *                  final amount (+ floor/ceiling annotations).
 *   • `notices`  — zero-or-more INFORMATIVE lines for an EXPECTED, benign posture
 *                  the operator should be able to see but NOT be alarmed by:
 *                    – `uncontainedScope` with a present-but-MODEST enforced tier
 *                      (`enforcedScopeTier !== null`, today honestly `'read'`): the
 *                      priced tier outruns what the sandbox structurally contains.
 *                      This is the documented pricing-ahead-of-containment gap and
 *                      is true on ~100% of full-tier spawns under an armed guard —
 *                      steady state, not an incident → INFO, naming both tiers.
 *   • `warnings` — zero-or-more LOUD lines for an ACTIONABLE anomaly where the IC
 *                  argument does NOT hold or the spawn is structurally unconfined:
 *                    – `belowFloor` — the ceiling clamp pushed the bond under the
 *                      tier's reconstruction-cost floor → bond < max_gain_from_sabotage.
 *                    – `uncontainedScope` with `enforcedScopeTier === null` — no OS
 *                      sandbox at all (degraded / guard off / a core bound missing),
 *                      so NOTHING is contained and the spawn is truly unconfined.
 *
 * The `uncontainedScope` flag's value is unchanged; this helper only chooses the
 * LEVEL (notice vs warn) for an uncontained quote. Both `uncontainedScope`
 * branches require a `coastGuardReport` to have been supplied to `priceBond`
 * (else the flag is `false` and neither fires). PURE.
 */
export function pricedBondLogLines(
  breakdown: PricedBondBreakdown,
  ctx: PricedBondLogContext,
): { info: string; notices: string[]; warnings: string[] } {
  const who =
    `${ctx.agentId ? ` agent=${ctx.agentId}` : ''}${ctx.backend ? ` backend=${ctx.backend}` : ''}`;
  const b = breakdown;
  const info =
    `[spawner] bond priced $${ctx.bondUsd.toFixed(4)} — tier=${b.scopeTier} ` +
    `base=$${b.base.toFixed(4)} ×scope=${b.scopeMultiplier} ×dur=${b.durationMultiplier} ` +
    `×rep=${b.reputationFactor} floor=$${b.floorUsd.toFixed(4)}` +
    `${b.floorApplied ? ' (floor applied)' : ''}${b.ceilingApplied ? ' (ceiling clamped)' : ''}` +
    who;
  const notices: string[] = [];
  const warnings: string[] = [];
  if (b.belowFloor) {
    warnings.push(
      `[spawner] WARN undercollateralized bond — ceiling clamp pushed $${ctx.bondUsd.toFixed(4)} ` +
        `BELOW the ${b.scopeTier}-tier deterrence floor $${b.floorUsd.toFixed(4)} ` +
        `(bond < max_gain_from_sabotage; IC invariant does NOT hold)${who}`,
    );
  }
  if (b.uncontainedScope) {
    if (b.enforcedScopeTier === null) {
      // ACTIONABLE: no OS sandbox at all (degraded posture / guard off / a core
      // bound missing) → the spawn is structurally unconfined. This is the
      // anomaly worth a LOUD warn.
      warnings.push(
        `[spawner] WARN uncontained scope — NO OS sandbox is active on this machine ` +
          `(degraded Coast Guard posture); the ${b.scopeTier}-tier spawn is structurally ` +
          `unconfined and the bond is its ONLY check (pricing != containment; deterrence ` +
          `sound but UNBACKED by enforcement)${who}`,
      );
    } else {
      // EXPECTED steady state: the priced tier exceeds a present-but-modest
      // enforced tier (today `'read'`). The default full-tier spawn trips this on
      // ~100% of spawns — informative, not alarming → INFO notice.
      notices.push(
        `[spawner] bond scope advisory — priced tier=${b.scopeTier} exceeds the Coast ` +
          `Guard's enforced containment tier=${b.enforcedScopeTier} on this machine; the bond ` +
          `underwrites a blast radius the runtime does not yet structurally prevent ` +
          `(pricing ahead of containment — known advisory gap, deterrence sound)${who}`,
      );
    }
  }
  return { info, notices, warnings };
}
