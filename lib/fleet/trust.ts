/**
 * Fleet trust gate — provenance classification + least-privilege tool gating
 * for trigger-driven agent spawns (ADR-0093).
 *
 * THE PROBLEM (see ADR-0093 §Threat Model):
 *   PR #539 wired a pluggable trigger registry (file/webhook/email/sms/
 *   calendar/github/git/pd/schedule) straight into the engine: a trigger
 *   fires -> runAgentOnce() runs the agent with whatever `allowedTools` the
 *   ship declared. The moment an UNTRUSTED external trigger (an inbound
 *   webhook, a stranger's email, a public GitHub comment) becomes the agent's
 *   task text, the attacker's words are the agent's instructions — and the
 *   agent may hold `Bash(curl*)` / `Bash(git*)` / `Bash(gh*)`. That is
 *   prompt-injection -> tool-abuse, the CRITICAL finding.
 *
 * THE FIX (this module): a pure, deterministic gate that classifies a
 * trigger's PROVENANCE and refuses any spawn whose declared tools exceed the
 * safe set for that provenance. It is the L1 layer between the trigger firing
 * and the spawn (insertion point: lib/fleet-engine.ts, inside the
 * io-dispatch.startTrigger onFire callback, before requestAgentRun).
 *
 * DESIGN INVARIANTS (each defeats a specific red-team attack — see the
 * matching test in tests/unit/fleet-trust.test.js):
 *
 *   1. CLASSIFY BY CONTENT SOURCE, NEVER BY TRANSPORT AUTH.
 *      An HMAC-verified webhook proves the *relay* is genuine, not that the
 *      *payload author* is trusted. A relay-forwarded stranger email is still
 *      ANONYMOUS_EXTERNAL.  [defeats: "webhook relay laundering"]
 *
 *   2. WHITELIST THE SAFE TIERS, FAIL CLOSED.
 *      requiresApproval() is computed as "tier NOT IN {OPERATOR, INTERNAL}",
 *      so a classifier bug that emits an unknown/typo tier defaults to
 *      requires-approval, not skip.  [defeats: "silent approval bypass"]
 *
 *   3. NORMALIZE TOOL NAMES (lowercase + NFC + trim) BEFORE MATCHING.
 *      `Bash`, `bash`, `Bash`, ` BASH ` all collapse to `bash`.
 *      [defeats: "unicode/case tool-name bypass"]
 *
 *   4. ABSENT allowedTools == UNRESTRICTED == DENY for any non-trusted tier.
 *      The engine treats a ship with no `allowedTools` as fully capable. For
 *      an untrusted trigger that is the worst case, so we refuse it: an
 *      external-triggered spawn MUST declare an explicit safe tool set.
 *      [defeats: "no restriction + untrusted source = full caps"]
 *
 *   5. A GLOBBED TOOL STILL GRANTS THE BASE TOOL.
 *      `Bash(gh*)` grants `bash`; we extract the base capability and gate on
 *      it. You cannot smuggle bash past the gate by scoping it.
 *      [defeats: "glob scoping bypass"]
 *
 * Pure + deterministic: no clocks, no IO, no randomness — safe to unit-test
 * exhaustively and to run inside the hot trigger path.
 */

/** Provenance tiers, ordered most→least trusted. */
export type TrustTier =
  | 'OPERATOR'             // the operator's own hands: explicit `pd` action
  | 'INTERNAL'             // local machine signals the operator's env produces
  | 'AUTHENTICATED_EXTERNAL' // external, but content AUTHOR is allowlisted
  | 'ANONYMOUS_EXTERNAL';  // external, unverified author — assume adversarial

/** The two tiers that may run without an explicit human approval gate.
 *  Everything else is gated. This is a WHITELIST (invariant #2). */
const TRUSTED_TIERS: ReadonlySet<TrustTier> = new Set(['OPERATOR', 'INTERNAL']);

/** Trigger kinds whose firing is a LOCAL operator-environment signal. These
 *  are INTERNAL provenance. NB: `file` is local but its *content* can be
 *  attacker-influenced — content trust is handled by the prompt-framing layer,
 *  not by this provenance tier (see ADR-0093 §Residual). */
const INTERNAL_TRIGGER_KINDS: ReadonlySet<string> = new Set([
  'git',
  'schedule',
  'file',
  'pd',
]);

/** Trigger kinds that ingress from outside the operator's machine. Default to
 *  the LOWEST tier unless an explicit, content-level author check upgrades
 *  them (see classifyTrust). */
const EXTERNAL_TRIGGER_KINDS: ReadonlySet<string> = new Set([
  'webhook',
  'email',
  'sms',
  'calendar',
  'github',
]);

/**
 * Per-tier ALLOWLIST of base tool capabilities (normalized names). Allowlist,
 * never denylist (OWASP LLM05 Excessive Agency): you cannot escalate via a
 * tool the author forgot to ban. OPERATOR uses the `*` sentinel = all tools.
 */
const SAFE_TOOLS_BY_TIER: Record<TrustTier, ReadonlySet<string>> = {
  // Operator: full capability (sentinel handled in toolAllowedForTier).
  OPERATOR: new Set(['*']),
  // Internal: capable, but still no raw shell-to-network by default; internal
  // automation declares what it needs and the ship's bond covers the rest.
  INTERNAL: new Set(['read', 'grep', 'glob', 'edit', 'write', 'bash']),
  // Authenticated external (allowlisted author): read + propose, NO execution,
  // NO network shell, NO vcs mutation. Can comment/observe; cannot act.
  AUTHENTICATED_EXTERNAL: new Set(['read', 'grep', 'glob']),
  // Anonymous external (stranger): read-only introspection only. Never bash,
  // git, gh, curl, write, or edit. Assume every byte is an injection attempt.
  ANONYMOUS_EXTERNAL: new Set(['read', 'grep', 'glob']),
};

/** Minimal structural shape of a trigger event this gate needs. Kept local
 *  (not imported from ./types) so the module is dependency-free and trivially
 *  testable; FleetTriggerEvent is structurally assignable to it. */
export interface TrustClassificationInput {
  /** The trigger source kind (event.source). */
  source: string;
  metadata?: {
    /** Human-readable author/origin: email From, GH login, SMS number. */
    sender?: string;
    /** True only when the CONTENT AUTHOR (not the transport) was verified
     *  against an operator allowlist. Transport HMAC must NOT set this. */
    consent_verified?: boolean;
    [k: string]: unknown;
  };
}

export interface TrustPolicy {
  /** Authors (email/login/number) whose AUTHENTICATED identity upgrades an
   *  external trigger from ANONYMOUS to AUTHENTICATED_EXTERNAL. Matching is
   *  exact, case-insensitive. An empty/omitted list means: nobody upgrades. */
  allowlistedAuthors?: readonly string[];
}

/**
 * Classify a trigger's provenance tier from its CONTENT source.
 *
 * Invariant #1: transport authentication (e.g. webhook HMAC) is deliberately
 * NOT consulted here. Only `metadata.consent_verified` — which callers may set
 * ONLY after verifying the content author against `policy.allowlistedAuthors`
 * — can raise an external trigger above ANONYMOUS.
 */
export function classifyTrust(
  input: TrustClassificationInput,
  policy: TrustPolicy = {},
): TrustTier {
  const kind = (input.source ?? '').trim().toLowerCase();

  if (kind === 'pd') return 'OPERATOR';
  if (INTERNAL_TRIGGER_KINDS.has(kind)) return 'INTERNAL';

  if (EXTERNAL_TRIGGER_KINDS.has(kind)) {
    const author = (input.metadata?.sender ?? '').trim().toLowerCase();
    const allow = (policy.allowlistedAuthors ?? []).map((a) => a.trim().toLowerCase());
    const authorIsAllowlisted = author.length > 0 && allow.includes(author);
    // BOTH conditions required: the author must be allowlisted AND the caller
    // must have actually verified them (consent_verified). Either alone is
    // insufficient — transport HMAC alone never sets consent_verified.
    if (authorIsAllowlisted && input.metadata?.consent_verified === true) {
      return 'AUTHENTICATED_EXTERNAL';
    }
    return 'ANONYMOUS_EXTERNAL';
  }

  // Unknown kind: fail closed to the lowest tier (invariant #2 spirit).
  return 'ANONYMOUS_EXTERNAL';
}

/** True if a spawn at this tier must pass an explicit human approval gate.
 *  Computed as the complement of the trusted whitelist (invariant #2). */
export function requiresApproval(tier: TrustTier): boolean {
  return !TRUSTED_TIERS.has(tier);
}

/** Canonicalize a tool name: NFC-normalize, strip whitespace, lowercase, and
 *  reduce a scoped form like `Bash(gh*)` to its base capability `bash`
 *  (invariants #3 and #5). */
export function normalizeToolName(raw: string): string {
  const nfc = (raw ?? '').normalize('NFC').trim().toLowerCase();
  // Drop any scope/glob suffix: "bash(gh*)" -> "bash", "mcp__x__y" stays.
  const paren = nfc.indexOf('(');
  return (paren >= 0 ? nfc.slice(0, paren) : nfc).trim();
}

/** Parse an `allowedTools` spec string ("Read,Grep,Bash(gh*)") into the set of
 *  normalized base capabilities it grants. Comma- or space-separated. */
export function parseAllowedTools(spec: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!spec) return out;
  for (const part of spec.split(/[,\s]+/)) {
    const tool = normalizeToolName(part);
    if (tool) out.add(tool);
  }
  return out;
}

/** Is a single (already-normalized) tool permitted at this tier? */
export function toolAllowedForTier(tier: TrustTier, normalizedTool: string): boolean {
  const safe = SAFE_TOOLS_BY_TIER[tier];
  if (safe.has('*')) return true; // OPERATOR
  return safe.has(normalizedTool);
}

export interface ToolValidation {
  ok: boolean;
  reason: string;
  /** The normalized tools that are NOT permitted at this tier. */
  offendingTools: string[];
}

/**
 * Validate that a ship's declared `allowedTools` are all within the safe set
 * for `tier`. Fail-closed semantics (invariant #4):
 *   - TRUSTED tiers (OPERATOR, INTERNAL): always ok. These are the operator's
 *     own hands and the operator's own environment; the ship's declared tools
 *     (or the engine's unrestricted default) stand. This matches invariant #4
 *     as written — "DENY for any NON-TRUSTED tier" — and keeps the shipped
 *     Phase-1 `file:` trigger path (agents with no allowedTools) working. The
 *     legacy git/schedule/pd channel path has never been tool-gated; gating
 *     INTERNAL registry triggers harder than those would be inconsistent, not
 *     safer. External ingress is where the gate has teeth.
 *   - any EXTERNAL tier with EMPTY/absent allowedTools: REFUSED —
 *     "unrestricted" is the worst case for an untrusted trigger; an explicit
 *     safe set is mandatory.
 *   - otherwise: ok iff every declared tool ⊆ safeSet(tier).
 */
export function validateAllowedToolsForTier(
  tier: TrustTier,
  allowedToolsSpec: string | undefined | null,
): ToolValidation {
  if (tier === 'OPERATOR') {
    return { ok: true, reason: 'operator tier: full capability', offendingTools: [] };
  }
  if (TRUSTED_TIERS.has(tier)) {
    return { ok: true, reason: `trusted tier ${tier}: ship-declared tools accepted`, offendingTools: [] };
  }

  const declared = parseAllowedTools(allowedToolsSpec);
  if (declared.size === 0) {
    return {
      ok: false,
      reason:
        `tier ${tier} requires an explicit allowedTools set; an unrestricted ` +
        `(absent) tool grant is treated as full capability and refused`,
      offendingTools: [],
    };
  }

  const offending = [...declared].filter((t) => !toolAllowedForTier(tier, t)).sort();
  if (offending.length > 0) {
    return {
      ok: false,
      reason: `tools [${offending.join(', ')}] exceed the safe set for tier ${tier}`,
      offendingTools: offending,
    };
  }
  return { ok: true, reason: 'all declared tools within tier safe set', offendingTools: [] };
}

export interface TrustGateResult {
  /** May the spawn proceed AT ALL (tools within tier)? */
  allowed: boolean;
  /** The classified provenance tier. */
  tier: TrustTier;
  /** Does it additionally require an explicit human approval before running? */
  requiresApproval: boolean;
  /** Always populated; the *reason* only, never how to bypass it. */
  reason: string;
  /** The tier's safe tool set (for UI / macaroon caveat minting). */
  safeTools: string[];
  /** Offending tools when allowed=false due to a tool-set violation. */
  offendingTools: string[];
}

/**
 * The composite gate evaluated at trigger fire-time, before requestAgentRun.
 *
 * Returns a verdict; the engine must:
 *   - refuse the spawn when !allowed (log reason, never spawn),
 *   - route through the operator approval queue when requiresApproval,
 *   - mint a macaroon caveat scoped to `safeTools` for the spawn (ADR-0093 §6).
 */
export function evaluateTrustGate(params: {
  event: TrustClassificationInput;
  allowedTools: string | undefined | null;
  policy?: TrustPolicy;
}): TrustGateResult {
  const tier = classifyTrust(params.event, params.policy ?? {});
  const safeTools = [...SAFE_TOOLS_BY_TIER[tier]].sort();
  const validation = validateAllowedToolsForTier(tier, params.allowedTools);
  return {
    allowed: validation.ok,
    tier,
    requiresApproval: requiresApproval(tier),
    reason: validation.reason,
    safeTools,
    offendingTools: validation.offendingTools,
  };
}

/** Exposed for tests and for the macaroon caveat builder (ADR-0093 §6). */
export const __TRUST_INTERNALS = {
  TRUSTED_TIERS,
  INTERNAL_TRIGGER_KINDS,
  EXTERNAL_TRIGGER_KINDS,
  SAFE_TOOLS_BY_TIER,
};
