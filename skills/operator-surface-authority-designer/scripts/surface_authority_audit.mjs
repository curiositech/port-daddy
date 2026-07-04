#!/usr/bin/env node
// surface_authority_audit.mjs — deterministic audit of an operator-surface
// authority spec against the Agent Harbor operator triad contract:
// Scout captures intent, FleetBar grants consent, pd-console shows the
// truth, and no surface owns runtime state.
// Pure stdlib, no deps.
//
// Usage:
//   node surface_authority_audit.mjs --input <surface-authority-spec>.json
//
// Exports:
//   auditSurfaceAuthority(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Canonical distance -> surface mapping (docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md).
// intake = Scout (inside the artifact), ambient = FleetBar (glanceable consent),
// deep = pd-console (seated, full-evidence inspection).
const CANONICAL_SURFACE_BY_DISTANCE = {
  intake: 'scout',
  ambient: 'fleetbar',
  deep: 'pd-console',
};

const VALID_SURFACES = new Set(['scout', 'fleetbar', 'pd-console']);
const VALID_DISTANCES = new Set(['intake', 'ambient', 'deep']);
const VALID_BUSES = new Set(['hot', 'cool']);

// Chapter 19's plane table names Work Intents and transcript events as
// cool-bus (durable, append-only) objects. Scout's job (capture intent) and
// pd-console's job (show transcript truth) are therefore both cool-bus at
// the capability level; only FleetBar's ambient digest legitimately mixes
// hot (roster ticks) and cool (approvals) traffic, so ambient is exempt from
// this check by design — see references/hot-bus-cool-bus-subscription-contract.md.
const EXPECTED_BUS_BY_CHECKED_DISTANCE = { intake: 'cool', deep: 'cool' };

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertShape(spec) {
  if (!isPlainObject(spec)) {
    throw new Error('auditSurfaceAuthority: input must be a JSON object');
  }
  if (!Array.isArray(spec.capabilities)) {
    throw new Error('auditSurfaceAuthority: "capabilities" must be an array (may be empty)');
  }
  if (typeof spec.surfacesOwnRuntimeState !== 'boolean') {
    throw new Error('auditSurfaceAuthority: "surfacesOwnRuntimeState" must be a boolean');
  }
  for (const [i, cap] of spec.capabilities.entries()) {
    if (!isPlainObject(cap)) {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] must be an object`);
    }
    if (typeof cap.name !== 'string' || cap.name.trim() === '') {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] must have a non-empty string "name"`);
    }
    if (typeof cap.assignedSurface !== 'string') {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] ("${cap.name}") must have a string "assignedSurface"`);
    }
    if (typeof cap.distance !== 'string') {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] ("${cap.name}") must have a string "distance"`);
    }
    if (typeof cap.evidenceScreens !== 'number' || !Number.isFinite(cap.evidenceScreens) || cap.evidenceScreens < 0) {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] ("${cap.name}") must have a non-negative number "evidenceScreens"`);
    }
    if (typeof cap.daemonEnforceable !== 'boolean') {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] ("${cap.name}") must have a boolean "daemonEnforceable"`);
    }
    if (typeof cap.busSubscription !== 'string') {
      throw new Error(`auditSurfaceAuthority: capabilities[${i}] ("${cap.name}") must have a string "busSubscription"`);
    }
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit an operator-surface authority spec against the three-surface triad
 * contract: Scout captures intent, FleetBar grants consent, pd-console shows
 * the truth, and no surface owns runtime state. Every capability must
 * belong to exactly one surface, chosen by its distance-from-work (intake /
 * ambient / deep), every rendered control must be one the daemon can
 * actually enforce, and each surface's hot-bus/cool-bus subscription must
 * match its declared distance.
 *
 * This is a design-time gate: it flags authority spreads and unenforceable
 * controls before implementation, using the same deterministic weighted-
 * deduction scoring as the other port-daddy audit scripts (fail closed —
 * an empty capability list or an absent runtime-state flag is never
 * treated as safe).
 *
 * @param {object} spec
 * @param {Array<{name:string, assignedSurface:string, distance:string, evidenceScreens:number, daemonEnforceable:boolean, busSubscription:string}>} spec.capabilities
 * @param {boolean} spec.surfacesOwnRuntimeState
 * @returns {{pass:boolean, score:number, findings:Array<{severity:string,id:string,message:string}>, recommendations:string[]}}
 */
export function auditSurfaceAuthority(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Fail closed: no capabilities declared is not a safe/vacuous spec ----
  if (spec.capabilities.length === 0) {
    pushFinding(
      findings, recommendations, 'critical', 'no-capabilities-declared',
      'No capabilities are declared; an empty spec cannot prove authority is divided correctly.',
      'Enumerate every capability the three surfaces expose, each with its assignedSurface, distance, and bus subscription, before auditing.',
    );
  }

  // --- Global: no surface may own runtime state -----------------------------
  if (spec.surfacesOwnRuntimeState === true) {
    pushFinding(
      findings, recommendations, 'critical', 'surface-owns-runtime-state',
      'A surface owns runtime state directly instead of rendering daemon truth — this breaks "no surface owns runtime state; all three render daemon truth and submit commands through the same envelopes."',
      'Move the owned state into the daemon (ledger/projection) and have every surface render it, rather than letting a surface be the source of truth for its own slice.',
    );
  }

  // --- Per-capability checks -------------------------------------------------
  for (const cap of spec.capabilities) {
    const hasValidSurface = VALID_SURFACES.has(cap.assignedSurface);
    const hasValidDistance = VALID_DISTANCES.has(cap.distance);

    if (cap.daemonEnforceable !== true) {
      pushFinding(
        findings, recommendations, 'critical', 'unenforceable-control-rendered',
        `Capability "${cap.name}" is rendered on "${cap.assignedSurface}" but the daemon cannot enforce it (daemonEnforceable: false).`,
        `Either wire "${cap.name}" through a daemon-enforced gate before rendering its control, or remove the control until the daemon can back it (acceptance criterion 6: controls are enabled only when the daemon can actually enforce them).`,
      );
    }

    if (hasValidSurface && cap.assignedSurface === 'fleetbar' && cap.evidenceScreens > 1) {
      pushFinding(
        findings, recommendations, 'critical', 'deep-evidence-in-fleetbar',
        `Capability "${cap.name}" needs ${cap.evidenceScreens} screens of evidence but is assigned to FleetBar; anything requiring more than one screen of evidence belongs in pd-console.`,
        `Move "${cap.name}" to pd-console and have FleetBar deep-link into it instead of growing a pane.`,
      );
    }

    if (hasValidDistance && Object.hasOwn(EXPECTED_BUS_BY_CHECKED_DISTANCE, cap.distance)) {
      const expectedBus = EXPECTED_BUS_BY_CHECKED_DISTANCE[cap.distance];
      if (cap.busSubscription !== expectedBus) {
        pushFinding(
          findings, recommendations, 'critical', 'bus-distance-mismatch',
          `Capability "${cap.name}" has distance "${cap.distance}" (expects the ${expectedBus} bus: ${cap.distance === 'intake' ? 'Work Intents are cool-bus objects' : 'transcript events are cool-bus objects'}) but subscribes to "${cap.busSubscription}".`,
          `Subscribe "${cap.name}" to the ${expectedBus} bus, or reclassify its distance if it is genuinely ambient-only ephemeral chatter.`,
        );
      }
    } else if (!hasValidDistance) {
      pushFinding(
        findings, recommendations, 'critical', 'bus-distance-mismatch',
        `Capability "${cap.name}" has an unrecognized distance "${cap.distance}"; a bus subscription cannot be verified against an unknown distance.`,
        `Set "${cap.name}".distance to one of "intake", "ambient", or "deep" so its bus subscription can be checked.`,
      );
    }

    if (!hasValidSurface) {
      pushFinding(
        findings, recommendations, 'critical', 'capability-multi-surface',
        `Capability "${cap.name}" has no valid assigned surface (got "${cap.assignedSurface}"): every capability must belong to exactly one of scout, fleetbar, or pd-console.`,
        `Assign "${cap.name}" to exactly one of scout, fleetbar, or pd-console, matching its declared distance.`,
      );
    } else if (hasValidDistance && CANONICAL_SURFACE_BY_DISTANCE[cap.distance] !== cap.assignedSurface) {
      pushFinding(
        findings, recommendations, 'critical', 'capability-multi-surface',
        `Capability "${cap.name}" is assigned to "${cap.assignedSurface}" but its distance ("${cap.distance}") is canonically owned by "${CANONICAL_SURFACE_BY_DISTANCE[cap.distance]}" — a capability whose surface disagrees with its distance is effectively unassigned from its rightful owner.`,
        `Reassign "${cap.name}" to "${CANONICAL_SURFACE_BY_DISTANCE[cap.distance]}", or correct its declared distance if the current surface is actually right.`,
      );
    }
  }

  // --- Cross-capability: same name claimed by more than one surface --------
  const byName = new Map();
  for (const cap of spec.capabilities) {
    if (!byName.has(cap.name)) byName.set(cap.name, []);
    byName.get(cap.name).push(cap);
  }
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue;
    const distinctSurfaces = new Set(entries.map((e) => e.assignedSurface));
    if (distinctSurfaces.size > 1) {
      pushFinding(
        findings, recommendations, 'critical', 'capability-multi-surface',
        `Capability "${name}" appears ${entries.length} times assigned to ${distinctSurfaces.size} different surfaces (${[...distinctSurfaces].join(', ')}) — a capability must belong to exactly one surface.`,
        `Pick the one surface "${name}" canonically belongs to by distance and remove the duplicate claims from the others.`,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Every capability has exactly one surface matching its distance, every control is daemon-enforceable, and no surface owns runtime state. Ship it.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: surface_authority_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditSurfaceAuthority(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`surface_authority_audit: ${error.message}\n`);
    process.exit(1);
  }
}
