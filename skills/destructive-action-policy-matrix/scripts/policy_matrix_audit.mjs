#!/usr/bin/env node
// policy_matrix_audit.mjs — deterministic audit of a destructive-action policy
// matrix (Agent Harbor binder C5: pre-tool / post-tool governance of
// destructive/gated actions). Pure stdlib, no deps.
//
// Usage:
//   node policy_matrix_audit.mjs --input <policy-matrix>.json
//
// Exports:
//   auditPolicyMatrix(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = ['git', 'filesystem', 'network', 'shell', 'github'];
const TIERS = ['block', 'approve', 'allow'];
const GATED_TIERS = ['block', 'approve'];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`auditPolicyMatrix: "${name}" must be an object`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`auditPolicyMatrix: "${name}" must be a boolean`);
  }
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`auditPolicyMatrix: "${name}" must be a non-empty string`);
  }
  return value;
}

function assertShape(spec) {
  requireObject(spec, 'spec');
  if (!Array.isArray(spec.actions)) {
    throw new Error('auditPolicyMatrix: "actions" must be an array (may be empty)');
  }
  spec.actions.forEach((action, i) => {
    const entry = requireObject(action, `actions[${i}]`);
    requireNonEmptyString(entry.name, `actions[${i}].name`);
    requireNonEmptyString(entry.category, `actions[${i}].category`);
    requireNonEmptyString(entry.tier, `actions[${i}].tier`);
    requireBoolean(entry.hasPreToolGate, `actions[${i}].hasPreToolGate`);
    requireBoolean(entry.hasDenialReceipt, `actions[${i}].hasDenialReceipt`);
    requireBoolean(entry.emitsTranscriptEvent, `actions[${i}].emitsTranscriptEvent`);
    requireBoolean(entry.sideEffectFreeOnBlockFixture, `actions[${i}].sideEffectFreeOnBlockFixture`);
    if (entry.safeAlternative !== undefined && typeof entry.safeAlternative !== 'string') {
      throw new Error(`auditPolicyMatrix: "actions[${i}].safeAlternative" must be a string when present`);
    }
  });
  if (spec.containmentClaim !== undefined) {
    const claim = requireObject(spec.containmentClaim, 'containmentClaim');
    requireBoolean(claim.sameUidBodyMarkedContained, 'containmentClaim.sameUidBodyMarkedContained');
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a destructive-action policy matrix against the C5 governance bar:
 * every gated action classified, blocked actions proven zero-side-effect,
 * and every denial backed by a receipt, a transcript event, and a safe
 * alternative. FAILS CLOSED — an empty matrix or an unresolved claim is
 * never treated as safe.
 *
 * @param {object} spec
 * @param {Array<{
 *   name: string,
 *   category: 'git'|'filesystem'|'network'|'shell'|'github',
 *   tier: 'block'|'approve'|'allow',
 *   hasPreToolGate: boolean,
 *   hasDenialReceipt: boolean,
 *   safeAlternative?: string,
 *   emitsTranscriptEvent: boolean,
 *   sideEffectFreeOnBlockFixture: boolean
 * }>} spec.actions
 * @param {{sameUidBodyMarkedContained: boolean}} [spec.containmentClaim]
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditPolicyMatrix(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];
  const actions = spec.actions;

  // An empty matrix proves nothing — fail closed rather than vacuously pass.
  if (actions.length === 0) {
    pushFinding(
      findings, 'critical', 'no-actions-classified',
      'spec.actions is empty. No destructive or gated action has been classified, so no safety claim can be made.',
      'Enumerate every destructive/gated action in scope (git, filesystem, network, shell, github) and classify each into block/approve/allow before auditing.',
      recommendations,
    );
  }

  // Duplicate names collapse two distinct policies into one entry silently.
  const seenNames = new Map();
  for (const action of actions) {
    seenNames.set(action.name, (seenNames.get(action.name) ?? 0) + 1);
  }
  for (const [name, count] of seenNames) {
    if (count > 1) {
      pushFinding(
        findings, 'medium', 'duplicate-action-name',
        `Action name "${name}" appears ${count} times in the matrix — only one policy can actually govern it.`,
        `Give each distinct action a unique name, or merge the duplicate entries into a single policy for "${name}".`,
        recommendations,
      );
    }
  }

  for (const action of actions) {
    const { name, category, tier } = action;

    if (!CATEGORIES.includes(category)) {
      pushFinding(
        findings, 'high', 'unrecognized-category',
        `Action "${name}" has category "${category}", not one of: ${CATEGORIES.join(', ')}.`,
        `Reclassify "${name}" into one of the known categories, or extend the taxonomy deliberately in references/destructive-action-taxonomy.md.`,
        recommendations,
      );
    }
    if (!TIERS.includes(tier)) {
      pushFinding(
        findings, 'high', 'unrecognized-tier',
        `Action "${name}" has tier "${tier}", not one of: ${TIERS.join(', ')}.`,
        `Reclassify "${name}" into block, approve, or allow — there is no fourth tier.`,
        recommendations,
      );
      continue; // Tier-dependent checks below can't run meaningfully on an unknown tier.
    }

    // Block-tier actions must prove they never took effect when denied. This
    // is the critical invariant: a "blocker" that still ran the command
    // is not a blocker.
    if (tier === 'block' && action.sideEffectFreeOnBlockFixture !== true) {
      pushFinding(
        findings, 'critical', 'blocked-action-has-side-effects',
        `Block-tier action "${name}" does not prove sideEffectFreeOnBlockFixture — a denial fixture has not shown the action produces zero side effects when blocked.`,
        `Run the negative fixture for "${name}" (e.g. destructive git in a dirty worktree) and prove the command is stopped before any side effect, then set sideEffectFreeOnBlockFixture: true.`,
        recommendations,
      );
    }

    // Every gated (block or approve) action must produce real denial evidence:
    // a receipt, a transcript event, and — for block tier — a safe alternative.
    if (GATED_TIERS.includes(tier)) {
      if (!action.hasPreToolGate) {
        pushFinding(
          findings, 'high', 'missing-pre-tool-gate',
          `Gated action "${name}" (tier: ${tier}) has no pre-tool gate — enforcement can only happen after the action has already run.`,
          `Wire "${name}" into pre-tool enforcement so the gate fires before the side effect, not after.`,
          recommendations,
        );
      }
      if (!action.hasDenialReceipt) {
        pushFinding(
          findings, 'critical', 'denial-without-receipt',
          `Gated action "${name}" (tier: ${tier}) has no denial receipt — a denial leaves no durable, machine-readable evidence.`,
          `Emit a denial receipt for "${name}" on every deny/hold decision (see references/denial-receipt-and-transcript-envelope.md).`,
          recommendations,
        );
      }
      if (!action.emitsTranscriptEvent) {
        pushFinding(
          findings, 'critical', 'denial-without-transcript-event',
          `Gated action "${name}" (tier: ${tier}) does not emit a transcript event on denial — the operator/reviewer has no visible record.`,
          `Record a transcript event for every denial of "${name}" so it is visible in the live and historical session view.`,
          recommendations,
        );
      }
    }

    // Block-tier specifically must offer a safe alternative — a bare denial
    // with no path forward just teaches agents to route around the gate.
    if (tier === 'block' && (!action.safeAlternative || action.safeAlternative.trim() === '')) {
      pushFinding(
        findings, 'critical', 'gated-action-no-safe-alternative',
        `Block-tier action "${name}" has no safeAlternative — denial offers no path forward.`,
        `Document a safe alternative for "${name}" (e.g. "git reset --hard" blocked -> offer "git stash" or a scoped "git checkout -- <path>") and set safeAlternative.`,
        recommendations,
      );
    }
  }

  // A same-UID or otherwise unmanaged body can never be truthfully marked
  // "contained" — containment requires an enforced isolation boundary, which
  // an unmanaged same-UID process definitionally lacks.
  if (spec.containmentClaim?.sameUidBodyMarkedContained === true) {
    pushFinding(
      findings, 'critical', 'same-uid-marked-contained',
      'containmentClaim.sameUidBodyMarkedContained is true. An unmanaged or same-UID body has no enforced isolation boundary and can never be truthfully marked contained.',
      'Remove the containment claim for this body, or move it behind a real isolation boundary (see sandboxed-adversarial-test-harness) before claiming containment.',
      recommendations,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Policy matrix meets the C5 bar: every action classified, every block proves zero side effects, every denial carries a receipt, transcript event, and (for blocks) a safe alternative.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: policy_matrix_audit.mjs --input <policy-matrix>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditPolicyMatrix(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`policy_matrix_audit: ${error.message}\n`);
    process.exit(1);
  }
}
