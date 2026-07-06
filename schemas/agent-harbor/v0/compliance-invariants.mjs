/**
 * Agent Harbor v0 — Compliance Witnessing Invariant (ADR-0095 §8).
 *
 * The draft-2020-12 keyword subset the contract commits to (type, properties,
 * required, enum, const, additionalProperties, items, min/max) cannot express a
 * cross-field, array-quantified rule like "a level is valid only if a matching
 * witnessed check AND a matching downgraded negative probe both exist." That
 * gap is exactly how a schema-valid ComplianceProbeResult could assert C6 with
 * an empty probe set and every check self-reported.
 *
 * This module is the normative, language-neutral enforcement of that rule: the
 * daemon (TypeScript) and any external consumer (Rust, custom agents) MUST
 * implement the same predicate. It is a frozen contract artifact, not prose —
 * tests/unit/agent-harbor-contracts.test.js gates it, so a self-attested level
 * fails CI, not just a code review.
 *
 * Grafted lenses: agent-compliance-conformance (level-advances-on-self-report,
 * missing-negative-probe, no-downgrade-on-forgery are all fail-closed here);
 * architecture-binder-of-record (this closes the schema-vs-ADR contradiction the
 * freeze's own tripwire is meant to catch).
 */

export const LADDER = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

/** Numeric order of a ladder level; -1 for unknown/null. */
export function levelOrder(level) {
  return LADDER.indexOf(level);
}

/**
 * A level Lk (order >= 1) is witnessed by a probe when BOTH hold:
 *   (a) some check gates Lk with daemon-observed positive evidence
 *       (level === Lk, daemonWitnessed === true, passed === true); and
 *   (b) some negative probe targets Lk (targetLevel === Lk), is present === true,
 *       and — if it fired — downgraded === true (a fired-but-not-downgraded forge
 *       is the worst case: proof the bypass works). An absent downgraded is never
 *       assumed true.
 * C0 (order 0) is always witnessed: registration needs no falsification.
 */
export function levelIsWitnessed(probe, level) {
  const order = levelOrder(level);
  if (order <= 0) return order === 0; // C0 free; unknown level never witnessed
  const checks = Array.isArray(probe.checks) ? probe.checks : [];
  const positive = checks.some(
    (c) => c && c.level === level && c.daemonWitnessed === true && c.passed === true,
  );
  if (!positive) return false;
  const probes = Array.isArray(probe.negativeProbes) ? probe.negativeProbes : [];
  const falsified = probes.some(
    (n) => n && n.targetLevel === level && n.present === true && (n.fired === true ? n.downgraded === true : true),
  );
  return positive && falsified;
}

/**
 * The daemon-computed witnessed level: the highest L such that every level from
 * C1..L is witnessed. Stops at the first gap, so an isolated high witness with a
 * hole beneath it does not grant the high level.
 */
export function witnessedComplianceLevel(probe) {
  let highest = 'C0';
  for (let i = 1; i < LADDER.length; i += 1) {
    if (!levelIsWitnessed(probe, LADDER[i])) break;
    highest = LADDER[i];
  }
  return highest;
}

/**
 * Validate a ComplianceProbeResult against the witnessing invariant.
 * Returns { valid, witnessedLevel, violations }.
 */
export function checkProbeWitnessing(probe) {
  const violations = [];
  const computed = witnessedComplianceLevel(probe);

  if (probe.witnessedLevel !== undefined && probe.witnessedLevel !== computed) {
    violations.push(
      `witnessedLevel field is ${JSON.stringify(probe.witnessedLevel)} but evidence supports ${computed} (level-advances-on-self-report)`,
    );
  }
  if (levelOrder(probe.complianceLevel) > levelOrder(computed)) {
    violations.push(
      `complianceLevel ${probe.complianceLevel} exceeds witnessed ${computed} — self-report is not evidence (level-advances-on-self-report)`,
    );
  }
  // no-downgrade-on-forgery: a present, fired forge that was not caught.
  for (const n of Array.isArray(probe.negativeProbes) ? probe.negativeProbes : []) {
    if (n && n.present === true && n.fired === true && n.downgraded !== true) {
      violations.push(`negative probe ${n.kind}@${n.targetLevel ?? '?'} fired but did not downgrade (no-downgrade-on-forgery)`);
    }
  }
  return { valid: violations.length === 0, witnessedLevel: computed, violations };
}

/** Throws when a probe violates the invariant. Fail-closed. */
export function assertProbeWitnessing(probe) {
  const { valid, violations } = checkProbeWitnessing(probe);
  if (!valid) throw new Error(`ComplianceProbeResult violates witnessing invariant: ${violations.join('; ')}`);
}

/**
 * An AgentNode's complianceLevel may never exceed the witnessedLevel of the
 * ComplianceProbeResult it is linked to. A level above C0 with no linked,
 * witness-valid probe is self-attested.
 */
export function checkNodeWitnessing(node, probe) {
  const violations = [];
  const order = levelOrder(node.complianceLevel);
  if (order > 0) {
    if (!node.complianceProbeId) {
      violations.push(`AgentNode.complianceLevel ${node.complianceLevel} has no complianceProbeId (self-attested)`);
    }
    if (!probe) {
      violations.push(`no witnessing probe supplied for complianceLevel ${node.complianceLevel}`);
    } else {
      const { valid, witnessedLevel, violations: pv } = checkProbeWitnessing(probe);
      if (!valid) violations.push(`linked probe is not witness-valid: ${pv.join('; ')}`);
      if (levelOrder(node.complianceLevel) > levelOrder(witnessedLevel)) {
        violations.push(`AgentNode.complianceLevel ${node.complianceLevel} exceeds linked probe witnessedLevel ${witnessedLevel}`);
      }
      if (node.complianceProbeId && probe.probeId && node.complianceProbeId !== probe.probeId) {
        violations.push(`complianceProbeId ${node.complianceProbeId} does not match supplied probe ${probe.probeId}`);
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

/** Throws when a node's granted level is not backed by its probe. Fail-closed. */
export function assertNodeWitnessing(node, probe) {
  const { valid, violations } = checkNodeWitnessing(node, probe);
  if (!valid) throw new Error(`AgentNode violates witnessing invariant: ${violations.join('; ')}`);
}
