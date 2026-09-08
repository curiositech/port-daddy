#!/usr/bin/env node
// Vendored from the local-first-tenancy-boundary skill so the ADR-0101 tenancy
// audit is re-runnable in-repo:
//   node docs/audits/tenancy_boundary_audit.mjs --input docs/audits/tenancy-boundary.spec.json
// tenancy_boundary_audit.mjs — deterministic audit of a product's local-first
// account/tenancy model and cloud data-boundary consent design. Pure stdlib,
// no deps.
//
// Usage:
//   node tenancy_boundary_audit.mjs --input <tenancy-boundary-spec.json>
//
// Exports:
//   auditTenancyBoundary(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE_TIERS = ['private', 'repo', 'team', 'public'];
const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditTenancyBoundary: input must be a JSON object');
  }
  if (!Array.isArray(spec.features)) {
    throw new Error('auditTenancyBoundary: "features" must be an array (may be empty)');
  }
  for (const [i, f] of spec.features.entries()) {
    if (!f || typeof f !== 'object') {
      throw new Error(`auditTenancyBoundary: features[${i}] must be an object`);
    }
    if (typeof f.name !== 'string' || f.name.trim() === '') {
      throw new Error(`auditTenancyBoundary: features[${i}].name is required and must be a non-empty string`);
    }
    if (typeof f.requiresIdentity !== 'boolean') {
      throw new Error(`auditTenancyBoundary: features[${i}] ("${f.name}").requiresIdentity must be a boolean`);
    }
    if (typeof f.hasLocalOnlyPath !== 'boolean') {
      throw new Error(`auditTenancyBoundary: features[${i}] ("${f.name}").hasLocalOnlyPath must be a boolean`);
    }
    if (!SCOPE_TIERS.includes(f.scopeTier)) {
      throw new Error(
        `auditTenancyBoundary: features[${i}] ("${f.name}").scopeTier must be one of ${SCOPE_TIERS.join(', ')}`,
      );
    }
    if (typeof f.crossesTierWithConsentScreen !== 'boolean') {
      throw new Error(
        `auditTenancyBoundary: features[${i}] ("${f.name}").crossesTierWithConsentScreen must be a boolean`,
      );
    }
  }
  if (!spec.localOnlyMode || typeof spec.localOnlyMode !== 'object') {
    throw new Error('auditTenancyBoundary: "localOnlyMode" object is required ({ uploadsNothingTestable })');
  }
  if (typeof spec.localOnlyMode.uploadsNothingTestable !== 'boolean') {
    throw new Error('auditTenancyBoundary: "localOnlyMode.uploadsNothingTestable" must be a boolean');
  }
  if (!spec.exportDelete || typeof spec.exportDelete !== 'object') {
    throw new Error('auditTenancyBoundary: "exportDelete" object is required ({ perTierSupported })');
  }
  if (typeof spec.exportDelete.perTierSupported !== 'boolean') {
    throw new Error('auditTenancyBoundary: "exportDelete.perTierSupported" must be a boolean');
  }
  if (typeof spec.scopeLadderOrdered !== 'boolean') {
    throw new Error('auditTenancyBoundary: "scopeLadderOrdered" must be a boolean');
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a local-first tenancy/account model against the data-boundary bar:
 * every identity-gated feature keeps a real local-only escape hatch, every
 * scope-tier crossing pauses on an explicit consent screen, the "local-only
 * uploads nothing" claim is runtime-testable rather than asserted, export/
 * delete controls exist per tier, and the private->repo->team->public scope
 * ladder is declared as a single ordered source of truth. FAILS CLOSED: an
 * empty feature list, a missing testability flag, or an unordered ladder are
 * all treated as unsafe, never as "nothing to report."
 *
 * @param {object} spec
 * @param {Array<{name:string, requiresIdentity:boolean, hasLocalOnlyPath:boolean,
 *   scopeTier:'private'|'repo'|'team'|'public', crossesTierWithConsentScreen:boolean}>} spec.features
 * @param {{uploadsNothingTestable:boolean}} spec.localOnlyMode
 * @param {{perTierSupported:boolean}} spec.exportDelete
 * @param {boolean} spec.scopeLadderOrdered
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditTenancyBoundary(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Fail closed on an empty feature inventory ----------------------------
  // An empty array proves nothing about safety; it means no feature has been
  // checked for a local-only path or a consent screen. Never read "nothing
  // declared" as "nothing wrong."
  if (spec.features.length === 0) {
    pushFinding(
      findings, recommendations, 'critical', 'no-features-declared',
      'features[] is empty — no feature has been verified to have a local-only path, a consent screen, or a safe scope tier.',
      'Enumerate every user-facing feature with its requiresIdentity, hasLocalOnlyPath, scopeTier, and crossesTierWithConsentScreen fields before claiming this boundary is safe.',
    );
  }

  // --- Per-feature checks ----------------------------------------------------
  for (const f of spec.features) {
    if (f.requiresIdentity === true && f.hasLocalOnlyPath === false) {
      pushFinding(
        findings, recommendations, 'critical', 'identity-gated-no-local-path',
        `Feature "${f.name}" requires identity and has no local-only path — account/passkey sign-in is load-bearing, not optional.`,
        `Ship "${f.name}" with a working local-only equivalent, or drop it from the identity-gated surface until one exists.`,
      );
    }
    if (f.scopeTier !== 'private' && f.crossesTierWithConsentScreen === false) {
      pushFinding(
        findings, recommendations, 'critical', 'tier-crossing-no-consent',
        `Feature "${f.name}" moves data to scope tier "${f.scopeTier}" with no explicit data-boundary consent screen.`,
        `Add an explicit consent screen that fires before "${f.name}" first crosses out of the private/local tier into "${f.scopeTier}".`,
      );
    }
    // Structural sanity: a feature that never leaves the device shouldn't be
    // flagged as needing (or having) a tier-crossing consent screen. This
    // doesn't block ship on its own, but it signals the spec disagrees with
    // itself about what this feature does.
    if (f.scopeTier === 'private' && f.crossesTierWithConsentScreen === true) {
      pushFinding(
        findings, recommendations, 'low', 'private-tier-flagged-as-crossing',
        `Feature "${f.name}" is scoped "private" but is also marked as crossing a tier with a consent screen — contradictory configuration.`,
        `Confirm "${f.name}"'s real scope tier: either it stays private (drop the consent-screen flag) or it actually crosses tiers (set scopeTier to the real destination).`,
      );
    }
  }

  // --- Local-only mode: is "uploads nothing" provable? ------------------------
  if (spec.localOnlyMode.uploadsNothingTestable !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'local-mode-uploads-not-testable',
      'localOnlyMode.uploadsNothingTestable is false — the "local-only mode uploads nothing" claim has no runtime-verifiable check behind it.',
      'Add a runtime-testable guarantee (e.g. a network-egress assertion or blocked-socket test) that proves local-only mode makes zero outbound calls.',
    );
  }

  // --- Export/delete controls per tier ----------------------------------------
  if (spec.exportDelete.perTierSupported !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'no-export-delete-per-tier',
      'exportDelete.perTierSupported is false — export and delete controls are not proven to work for every scope tier data can land in.',
      'Implement and verify export/delete for every scope tier in play (private, repo, team, public) before shipping account/tenancy features.',
    );
  }

  // --- Scope ladder ordering ----------------------------------------------------
  if (spec.scopeLadderOrdered !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'scope-ladder-unordered',
      'scopeLadderOrdered is false — the private -> repo -> team -> public scope ladder is not declared as a single ordered source of truth.',
      'Declare the scope ladder once, in order (private, repo, team, public), and have every role/consent check derive from that single ordering instead of re-deriving it ad hoc.',
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Tenancy boundary meets the bar: every identity-gated feature has a local-only path, every tier crossing shows consent, local-only mode is provably upload-free, export/delete works per tier, and the scope ladder is ordered.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: tenancy_boundary_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditTenancyBoundary(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`tenancy_boundary_audit: ${error.message}\n`);
    process.exit(1);
  }
}
