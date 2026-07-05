/**
 * Agent Harbor v0 — Governance Gate Invariants (binder ch18 Work Order C5).
 *
 * Companion to compliance-invariants.mjs (ADR-0095 §8): the draft-2020-12
 * keyword subset the contracts commit to cannot express cross-field rules like
 * "a block-tier pre-tool envelope must not carry decision: proceeded" or
 * "a block-tier denial receipt must offer a safe alternative." This module is
 * the normative, language-neutral enforcement of those rules; the TypeScript
 * daemon gate (lib/agent-harbor/governance/tool-gate.ts) and any external
 * consumer MUST implement the identical predicates. It is a frozen contract
 * artifact gated by tests/unit/agent-harbor-governance.test.js.
 *
 * Grafted lenses: destructive-action-policy-matrix (the-blocker-that-still-ran,
 * the-silent-denial, overclaiming-containment are all fail-closed here);
 * sandboxed-adversarial-test-harness (fail-closed on ambiguity — an
 * unresolvable check defaults to violation, never to safe);
 * macos-host-security (the cardinal rule: a same-UID body is DETECTION and
 * EVIDENCE, never containment — never market a same-UID watcher as a wall).
 */

export const CATEGORIES = ['git', 'filesystem', 'network', 'shell', 'github'];
export const TIERS = ['block', 'approve', 'allow'];
export const GATED_TIERS = ['block', 'approve'];

/**
 * The Blocker That Still Ran + The Silent Denial, as envelope predicates.
 * Returns { valid, violations } for one ToolGateEnvelope.
 *
 * - A PRE-tool envelope for a block-tier action with decision "proceeded" is a
 *   contradiction: if it proceeded, the gate did not block (skill reference:
 *   denial-receipt-and-transcript-envelope.md).
 * - A POST-tool envelope for a block-tier action that proceeded means the
 *   action was only observed after its side effects — the pre-tool hook was
 *   missing or bypassed. That is the missing-hook negative fixture's teeth.
 * - A denied/held decision with no transcript events is a silent denial.
 * - A denied decision with no denial receipt link leaves no durable evidence.
 * - gateIntegrity other than "enforced" may never coexist with a gated action
 *   proceeding: fail closed means deny when enforcement cannot be guaranteed.
 */
export function checkEnvelope(envelope) {
  const violations = [];
  const gated = GATED_TIERS.includes(envelope.tier);

  if (envelope.tier === 'block' && envelope.decision === 'proceeded') {
    violations.push(
      envelope.phase === 'pre-tool'
        ? 'block-tier pre-tool envelope with decision "proceeded" — if it proceeded, the gate did not block (the-blocker-that-still-ran)'
        : 'block-tier action observed post-tool with decision "proceeded" — side effects already happened; the pre-tool hook was missing or bypassed (missing-hook)',
    );
  }
  if (gated && (envelope.decision === 'denied' || envelope.decision === 'held')) {
    const events = Array.isArray(envelope.transcriptEventIds) ? envelope.transcriptEventIds : [];
    if (events.length === 0) {
      violations.push(`${envelope.tier}-tier ${envelope.decision} with no transcriptEventIds — a denial nobody can see is a silent denial (denial-without-transcript-event)`);
    }
  }
  if (envelope.decision === 'denied' && !envelope.denialReceiptId) {
    violations.push('decision "denied" with no denialReceiptId — no durable, machine-readable evidence (denial-without-receipt)');
  }
  if (envelope.decision === 'held' && !envelope.humanGateId) {
    violations.push('decision "held" with no humanGateId — nothing routes the approve/reject/modify decision back');
  }
  if (gated && envelope.gateIntegrity !== undefined && envelope.gateIntegrity !== 'enforced'
      && (envelope.decision === 'proceeded' || envelope.decision === 'held')) {
    violations.push(`gateIntegrity "${envelope.gateIntegrity}" with decision "${envelope.decision}" on a gated action — when enforcement cannot be guaranteed the only sound decision is denied (fail-closed)`);
  }
  return { valid: violations.length === 0, violations };
}

/** Throws when an envelope violates the gate invariants. Fail-closed. */
export function assertEnvelope(envelope) {
  const { valid, violations } = checkEnvelope(envelope);
  if (!valid) throw new Error(`ToolGateEnvelope violates governance invariants: ${violations.join('; ')}`);
}

/**
 * Denial-receipt predicates (the three load-bearing fields).
 * - block-tier denials MUST carry a concrete, non-empty safeAlternative.
 * - sideEffectFree may only be true when the caller proved it by fixture;
 *   this predicate cannot see the fixture, but it CAN catch the inverse lie:
 *   a receipt claiming sideEffectFree while decision is not a denial.
 * - transcriptEventId must be present and non-empty (schema requires it, but
 *   consumers of hand-built receipts re-check here — tolerant reader, strict writer).
 */
export function checkDenialReceipt(receipt) {
  const violations = [];
  if (receipt.tier === 'block') {
    const alt = typeof receipt.safeAlternative === 'string' ? receipt.safeAlternative.trim() : '';
    if (alt === '') {
      violations.push('block-tier denial with no safeAlternative — a bare denial teaches agents to route around the gate (gated-action-no-safe-alternative)');
    }
  }
  if (!GATED_TIERS.includes(receipt.tier)) {
    violations.push(`denial receipt for tier "${receipt.tier}" — only gated tiers (block, approve) can be denied`);
  }
  if (typeof receipt.transcriptEventId !== 'string' || receipt.transcriptEventId.trim() === '') {
    violations.push('denial receipt with no transcriptEventId — evidence that exists only in a log nobody sees (denial-without-transcript-event)');
  }
  if (receipt.decision !== 'denied' && receipt.decision !== 'held') {
    violations.push(`denial receipt with decision "${receipt.decision}" — a receipt records a deny/hold, nothing else`);
  }
  return { valid: violations.length === 0, violations };
}

/** Throws when a denial receipt violates the invariants. Fail-closed. */
export function assertDenialReceipt(receipt) {
  const { valid, violations } = checkDenialReceipt(receipt);
  if (!valid) throw new Error(`DenialReceipt violates governance invariants: ${violations.join('; ')}`);
}

/**
 * Overclaiming Containment — the never-contained rule.
 *
 * Containment is a property of an enforced isolation boundary (separate OS
 * user, sandbox, container), not of having a policy on file. A same-UID or
 * unmanaged body can be GOVERNED by the matrix; it can never be truthfully
 * marked CONTAINED (macos-host-security cardinal rule; skill finding
 * same-uid-marked-contained). Fail-closed: unknown isolation is treated as
 * same-UID.
 */
export function checkContainmentClaim(claim, body = {}) {
  const violations = [];
  const sameUid = body.sameUid !== false; // unknown → assume same-UID (fail closed)
  const managed = body.managed === true; // unknown → assume unmanaged (fail closed)
  if (claim.sameUidBodyMarkedContained === true) {
    violations.push('containmentClaim.sameUidBodyMarkedContained is true — a same-UID/unmanaged body has no enforced isolation boundary and can never be truthfully marked contained (same-uid-marked-contained)');
  }
  if (claim.contained === true && (sameUid || !managed)) {
    violations.push('claim.contained is true for a same-UID or unmanaged body — governance is not containment; real containment needs an authority outside the agent UID');
  }
  return { valid: violations.length === 0, violations };
}

/** Throws on an overclaimed containment. Fail-closed. */
export function assertContainmentClaim(claim, body = {}) {
  const { valid, violations } = checkContainmentClaim(claim, body);
  if (!valid) throw new Error(`ContainmentClaim violates governance invariants: ${violations.join('; ')}`);
}
