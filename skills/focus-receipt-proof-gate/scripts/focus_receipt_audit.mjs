#!/usr/bin/env node
// focus_receipt_audit.mjs — deterministic audit of a "current product focus
// receipt" (Agent Harbor binder, ch.18) and the work order it gates, before
// any agent is launched against it. Pure stdlib, no deps.
//
// Usage:
//   node focus_receipt_audit.mjs --input <focus-receipt>.json
//
// Exports:
//   auditFocusReceipt(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

// The seven receipt fields that are just "must be a real, stated thing" —
// bundled under one generic finding so the three named anti-pattern findings
// (no-first-visible-proof, no-kill-trigger, acceptance-gate-not-daemon-testable)
// stay distinct signals rather than getting lost in a pile of missing-field noise.
const GENERIC_REQUIRED_RECEIPT_FIELDS = ['decision', 'now', 'whyNow', 'evidence', 'owner', 'reviewDate'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertShape(spec) {
  if (!isPlainObject(spec)) {
    throw new Error('auditFocusReceipt: input must be a JSON object');
  }
  if (!isPlainObject(spec.receipt)) {
    throw new Error(
      'auditFocusReceipt: "receipt" object is required ({ decision, now, whyNow, evidence, firstVisibleProof, ' +
        'acceptanceGate, killRevisitTrigger, owner, reviewDate })',
    );
  }
  if (!isPlainObject(spec.workOrder)) {
    throw new Error('auditFocusReceipt: "workOrder" object is required ({ input, output, owner, proofGate })');
  }
  const { acceptanceGate } = spec.receipt;
  if (acceptanceGate !== undefined && !isPlainObject(acceptanceGate)) {
    throw new Error(
      'auditFocusReceipt: "receipt.acceptanceGate", when present, must be an object ({ statement, testableAgainstDaemonTruth })',
    );
  }
  if (
    acceptanceGate &&
    acceptanceGate.testableAgainstDaemonTruth !== undefined &&
    typeof acceptanceGate.testableAgainstDaemonTruth !== 'boolean'
  ) {
    throw new Error('auditFocusReceipt: "receipt.acceptanceGate.testableAgainstDaemonTruth", when present, must be a boolean');
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a "current product focus receipt" plus the work order it gates
 * against the Agent Harbor binder's own rule (ch.18): a focus receipt must
 * name a real decision with entry and exit criteria, an acceptance gate
 * provable from daemon truth (not a cached UI model), and a work order that
 * states its input, output, owner, and proof gate — or it is a planning
 * placeholder, not an agent launch.
 *
 * @param {object} spec
 * @param {object} spec.receipt
 * @param {string} spec.receipt.decision
 * @param {string} spec.receipt.now
 * @param {string} spec.receipt.whyNow
 * @param {string} spec.receipt.evidence
 * @param {string} spec.receipt.firstVisibleProof
 * @param {{statement:string, testableAgainstDaemonTruth:boolean}} spec.receipt.acceptanceGate
 * @param {string} spec.receipt.killRevisitTrigger
 * @param {string} spec.receipt.owner
 * @param {string} spec.receipt.reviewDate - ISO-8601 date this decision must be revisited by.
 * @param {object} spec.workOrder
 * @param {string} spec.workOrder.input
 * @param {string} spec.workOrder.output
 * @param {string} spec.workOrder.owner
 * @param {string} spec.workOrder.proofGate
 * @param {object} [options] - Optional. Omitting it preserves the original
 *   one-argument behaviour exactly, so existing callers are unaffected.
 * @param {number} [options.now] - Epoch ms to evaluate `reviewDate` against.
 *   Defaults to `Date.now()`. Supply it when a caller needs a deterministic
 *   verdict — a committed fixture asserted against the wall clock silently
 *   becomes a dated failure, which is what this parameter exists to prevent.
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditFocusReceipt(spec, options = {}) {
  assertShape(spec);

  // Evaluation instant, injectable. The reviewDate check below is the one
  // assertion in this auditor that depends on WHEN it runs, which makes any
  // committed sample receipt a dated bomb: `examples/sample-input.json` carried
  // reviewDate 2026-08-15 and passed CI every day until 2026-08-16, when it
  // began failing `tests/unit/agent-governance-skills.test.js` on every PR in
  // the repo, none of which had touched this skill. Callers that need a
  // deterministic verdict pin `now`; production passes nothing and gets the
  // wall clock, so the staleness check itself is unchanged.
  const now = options.now ?? Date.now();

  const findings = [];
  const recommendations = [];
  const receipt = spec.receipt;
  const workOrder = spec.workOrder;
  const acceptanceGate = isPlainObject(receipt.acceptanceGate) ? receipt.acceptanceGate : {};

  // --- Generic required receipt fields --------------------------------------
  for (const field of GENERIC_REQUIRED_RECEIPT_FIELDS) {
    if (!isNonEmptyString(receipt[field])) {
      pushFinding(
        findings, recommendations, 'critical', 'receipt-missing-required-field',
        `Focus receipt is missing required field "${field}".`,
        `Add a real, non-empty "${field}" to the focus receipt — an absent field is a placeholder, not a decision.`,
      );
    }
  }
  if (!isNonEmptyString(acceptanceGate.statement)) {
    pushFinding(
      findings, recommendations, 'critical', 'receipt-missing-required-field',
      'Focus receipt is missing required field "acceptanceGate.statement".',
      'State the acceptance gate as a concrete, checkable claim, not an implied bar.',
    );
  }

  // --- Entry criterion: First Visible Proof ----------------------------------
  if (!isNonEmptyString(receipt.firstVisibleProof)) {
    pushFinding(
      findings, recommendations, 'critical', 'no-first-visible-proof',
      'Focus receipt names no First Visible Proof — no observable artifact that proves the decision produced something real.',
      'Name the exact user-visible artifact (a screen, a saved event, a passing probe) that will exist once this focus is real.',
    );
  }

  // --- Exit criterion: Kill/Revisit Trigger ----------------------------------
  if (!isNonEmptyString(receipt.killRevisitTrigger)) {
    pushFinding(
      findings, recommendations, 'critical', 'no-kill-trigger',
      'Focus receipt names no Kill/Revisit Trigger — no condition under which this decision is paused or re-litigated.',
      'Name the exact condition (e.g. "if X cannot be made reliable") that pauses this focus and forces a revisit.',
    );
  }

  // --- Acceptance gate must be testable against daemon truth -----------------
  // Fail closed: only a literal `true` counts as safe. Missing, false, or any
  // other value means the gate may only prove a cached UI model, which the
  // binder explicitly rejects ("the proof must survive relaunch from daemon
  // truth, not from a cached UI model").
  if (acceptanceGate.testableAgainstDaemonTruth !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'acceptance-gate-not-daemon-testable',
      'Acceptance gate is not marked testable against daemon truth — it may only prove a cached UI state, not what the backend actually did.',
      'Rewrite the acceptance gate so it can be proven by rebuilding visible state from daemon/event truth after a restart or reconnect, and set testableAgainstDaemonTruth: true only when that is actually possible.',
    );
  }

  // --- Review date freshness (structured date comparison, not text content) --
  if (isNonEmptyString(receipt.reviewDate)) {
    const parsed = Date.parse(receipt.reviewDate);
    if (Number.isNaN(parsed)) {
      pushFinding(
        findings, recommendations, 'medium', 'invalid-review-date',
        `Focus receipt "reviewDate" ("${receipt.reviewDate}") is not a parseable date.`,
        'Use an ISO-8601 date (YYYY-MM-DD) for reviewDate so staleness can be checked automatically.',
      );
    } else if (parsed < now) {
      pushFinding(
        findings, recommendations, 'high', 'review-date-elapsed',
        `Focus receipt's reviewDate ("${receipt.reviewDate}") has passed — this decision has not been revisited with evidence since.`,
        'Revisit the focus receipt: confirm the decision still holds with current evidence, or supersede it with a new receipt and a new reviewDate.',
      );
    }
  }

  // --- Work order: input/output/owner/proofGate must all be stated -----------
  const requiredWorkOrderFields = ['input', 'output', 'owner', 'proofGate'];
  const missingWorkOrderFields = requiredWorkOrderFields.filter((field) => !isNonEmptyString(workOrder[field]));
  if (missingWorkOrderFields.length > 0) {
    pushFinding(
      findings, recommendations, 'critical', 'placeholder-not-launch',
      `Work order cannot state ${missingWorkOrderFields.map((f) => `"${f}"`).join(', ')} — per the binder's own rule, a ` +
        'chain that cannot state its input, output, owner, and proof gate is a planning placeholder, not an agent launch.',
      `State a real ${missingWorkOrderFields.join('/')} before treating this as an agent launch, or keep it as a backlog idea, not a work order.`,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Focus receipt is real and its work order is launch-ready: every required field is stated, entry/exit criteria ' +
        'are named, the acceptance gate is daemon-testable, and the work order states input/output/owner/proof gate. Launch it.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: focus_receipt_audit.mjs --input <focus-receipt>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditFocusReceipt(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`focus_receipt_audit: ${error.message}\n`);
    process.exit(1);
  }
}
