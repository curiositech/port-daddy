#!/usr/bin/env node
// conformance_audit.mjs — deterministic audit of a compliance-ladder design +
// adapter conformance fixtures before any C-badge / T-fidelity label ships.
// Pure stdlib, no deps.
//
// Usage:
//   node conformance_audit.mjs --input <conformance-spec>.json
//
// Exports:
//   auditConformance(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The five hostile negative probes every adapter fixture must exercise (see
// references/negative-probe-catalog.md). These are drawn directly from the
// binder's red-team "required hostile probes" list — they are not
// discretionary extras.
const REQUIRED_PROBE_KINDS = [
  'forged-level',
  'direct-mcp-bypass',
  'disabled-hook-after-launch',
  'forged-heartbeat',
  'observed-to-controlled',
];

// A frozen ladder must agree across all four places it can be declared.
const REQUIRED_SURFACE_KINDS = ['doc', 'schema', 'ui', 'probe'];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function assertLevelShape(level, path) {
  if (!level || typeof level.id !== 'string' || level.id.trim() === '') {
    throw new Error(`auditConformance: ${path} must have a non-empty string "id"`);
  }
  if (typeof level.order !== 'number' || !Number.isInteger(level.order) || level.order < 0) {
    throw new Error(`auditConformance: ${path} ("${level.id}") must have a non-negative integer "order"`);
  }
  if (typeof level.name !== 'string' || level.name.trim() === '') {
    throw new Error(`auditConformance: ${path} ("${level.id}") must have a non-empty string "name"`);
  }
  if (!Array.isArray(level.requiredPredicates)) {
    throw new Error(`auditConformance: ${path} ("${level.id}") must have a "requiredPredicates" array`);
  }
  for (const predicate of level.requiredPredicates) {
    if (typeof predicate !== 'string' || predicate.trim() === '') {
      throw new Error(`auditConformance: ${path} ("${level.id}") "requiredPredicates" entries must be non-empty strings`);
    }
  }
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditConformance: input must be a JSON object');
  }
  if (!Array.isArray(spec.ladders) || spec.ladders.length === 0) {
    throw new Error('auditConformance: "ladders" must be a non-empty array');
  }
  for (const [i, ladder] of spec.ladders.entries()) {
    if (!ladder || typeof ladder.name !== 'string' || ladder.name.trim() === '') {
      throw new Error(`auditConformance: ladders[${i}] must have a non-empty string "name"`);
    }
    if (!Array.isArray(ladder.levels) || ladder.levels.length === 0) {
      throw new Error(`auditConformance: ladders[${i}] ("${ladder.name}") must have a non-empty "levels" array`);
    }
    for (const [j, level] of ladder.levels.entries()) {
      assertLevelShape(level, `ladders[${i}].levels[${j}]`);
    }
  }
  if (!Array.isArray(spec.surfaces)) {
    throw new Error('auditConformance: "surfaces" must be an array (may be empty)');
  }
  for (const [i, surface] of spec.surfaces.entries()) {
    if (!surface || typeof surface.kind !== 'string' || !REQUIRED_SURFACE_KINDS.includes(surface.kind)) {
      throw new Error(`auditConformance: surfaces[${i}] must have "kind" one of ${REQUIRED_SURFACE_KINDS.join('|')}`);
    }
    if (typeof surface.ladder !== 'string' || surface.ladder.trim() === '') {
      throw new Error(`auditConformance: surfaces[${i}] must have a non-empty string "ladder"`);
    }
    if (!Array.isArray(surface.levels)) {
      throw new Error(`auditConformance: surfaces[${i}] must have a "levels" array`);
    }
    for (const [j, level] of surface.levels.entries()) {
      assertLevelShape(level, `surfaces[${i}].levels[${j}]`);
    }
  }
  if (!Array.isArray(spec.adapters) || spec.adapters.length === 0) {
    throw new Error('auditConformance: "adapters" must be a non-empty array');
  }
  for (const [i, adapter] of spec.adapters.entries()) {
    if (!adapter || typeof adapter.name !== 'string' || adapter.name.trim() === '') {
      throw new Error(`auditConformance: adapters[${i}] must have a non-empty string "name"`);
    }
    if (typeof adapter.ladder !== 'string' || adapter.ladder.trim() === '') {
      throw new Error(`auditConformance: adapters[${i}] ("${adapter.name}") must have a non-empty string "ladder"`);
    }
    if (typeof adapter.claimedLevel !== 'string' || adapter.claimedLevel.trim() === '') {
      throw new Error(`auditConformance: adapters[${i}] ("${adapter.name}") must have a non-empty string "claimedLevel"`);
    }
    if (!Array.isArray(adapter.negativeProbes)) {
      throw new Error(`auditConformance: adapters[${i}] ("${adapter.name}") must have a "negativeProbes" array`);
    }
    for (const [j, probe] of adapter.negativeProbes.entries()) {
      if (!probe || typeof probe.kind !== 'string' || !REQUIRED_PROBE_KINDS.includes(probe.kind)) {
        throw new Error(
          `auditConformance: adapters[${i}].negativeProbes[${j}] must have "kind" one of ${REQUIRED_PROBE_KINDS.join(', ')}`,
        );
      }
      if (typeof probe.present !== 'boolean') {
        throw new Error(`auditConformance: adapters[${i}].negativeProbes[${j}] ("${probe.kind}") must have boolean "present"`);
      }
      if ('downgraded' in probe && typeof probe.downgraded !== 'boolean') {
        throw new Error(`auditConformance: adapters[${i}].negativeProbes[${j}] ("${probe.kind}") "downgraded" must be boolean when present`);
      }
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

function predicateSetKey(predicates) {
  return [...predicates].sort().join('|');
}

function levelsMatch(a, b) {
  return (
    a.order === b.order &&
    a.name === b.name &&
    predicateSetKey(a.requiredPredicates) === predicateSetKey(b.requiredPredicates)
  );
}

/**
 * Audit a compliance-ladder design + adapter conformance fixtures against the
 * agent-compliance-conformance bar: every doc/schema/ui/probe surface agrees
 * on level id/order/name/requiredPredicates, and every non-base level is
 * backed by at least one adapter fixture whose required hostile negative
 * probes actually fired (present) and were caught (downgraded) — not merely
 * claimed. FAILS CLOSED: an absent probe, an absent "downgraded" flag, or a
 * level nobody's fixture backs is never treated as safe.
 *
 * @param {object} spec
 * @param {Array<{name:string, levels:Array<{id:string, order:number, name:string, requiredPredicates:string[]}>}>} spec.ladders
 * @param {Array<{kind:'doc'|'schema'|'ui'|'probe', ladder:string, levels:Array}>} spec.surfaces
 * @param {Array<{name:string, ladder:string, claimedLevel:string, negativeProbes:Array<{kind:string, present:boolean, downgraded?:boolean}>}>} spec.adapters
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditConformance(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  const ladderByName = new Map(spec.ladders.map((l) => [l.name, l]));

  // --- 1. Ladder drift across surfaces --------------------------------------
  for (const surface of spec.surfaces) {
    const canonical = ladderByName.get(surface.ladder);
    if (!canonical) {
      pushFinding(
        findings, 'high', 'undeclared-ladder-reference',
        `Surface "${surface.kind}" declares ladder "${surface.ladder}", which is not defined in "ladders".`,
        `Add "${surface.ladder}" to "ladders", or fix the "${surface.kind}" surface's "ladder" reference.`,
        recommendations,
      );
      continue;
    }
    const canonicalById = new Map(canonical.levels.map((l) => [l.id, l]));
    const surfaceById = new Map(surface.levels.map((l) => [l.id, l]));
    for (const [id, level] of canonicalById) {
      const surfaceLevel = surfaceById.get(id);
      if (!surfaceLevel) {
        pushFinding(
          findings, 'critical', 'ladder-name-order-drift',
          `Surface "${surface.kind}" for ladder "${surface.ladder}" omits level "${id}" ("${level.name}") that the canonical ladder defines.`,
          `Add level "${id}" to the "${surface.kind}" surface with the exact name, order, and requiredPredicates from the canonical ladder.`,
          recommendations,
        );
        continue;
      }
      if (!levelsMatch(level, surfaceLevel)) {
        pushFinding(
          findings, 'critical', 'ladder-name-order-drift',
          `Surface "${surface.kind}" for ladder "${surface.ladder}" disagrees with the canonical definition of level "${id}": ` +
            `canonical is {order:${level.order}, name:"${level.name}", requiredPredicates:[${level.requiredPredicates.join(', ')}]}, ` +
            `surface has {order:${surfaceLevel.order}, name:"${surfaceLevel.name}", requiredPredicates:[${surfaceLevel.requiredPredicates.join(', ')}]}.`,
          `Freeze one ladder definition and make the "${surface.kind}" surface match it exactly (same name, order, and requiredPredicates for "${id}").`,
          recommendations,
        );
      }
    }
    for (const id of surfaceById.keys()) {
      if (!canonicalById.has(id)) {
        pushFinding(
          findings, 'critical', 'ladder-name-order-drift',
          `Surface "${surface.kind}" for ladder "${surface.ladder}" declares level "${id}", which the canonical ladder does not define.`,
          `Remove "${id}" from the "${surface.kind}" surface, or add it to the canonical ladder if it is genuinely a new level.`,
          recommendations,
        );
      }
    }
  }

  // --- 1b. Surface coverage completeness ------------------------------------
  for (const ladder of spec.ladders) {
    const kindsSeen = new Set(spec.surfaces.filter((s) => s.ladder === ladder.name).map((s) => s.kind));
    const missingKinds = REQUIRED_SURFACE_KINDS.filter((k) => !kindsSeen.has(k));
    if (missingKinds.length > 0) {
      pushFinding(
        findings, 'medium', 'incomplete-surface-coverage',
        `Ladder "${ladder.name}" has no surface declaration for: ${missingKinds.join(', ')}. A frozen ladder must agree across doc, schema, UI, and probe form.`,
        `Add a surface entry for ${missingKinds.join(', ')} declaring ladder "${ladder.name}" so drift can be caught wherever it could appear.`,
        recommendations,
      );
    }
  }

  // --- 2 & 3. Per-adapter negative-probe coverage ---------------------------
  for (const adapter of spec.adapters) {
    const ladder = ladderByName.get(adapter.ladder);
    if (!ladder) {
      pushFinding(
        findings, 'high', 'undeclared-ladder-reference',
        `Adapter "${adapter.name}" claims a level on ladder "${adapter.ladder}", which is not defined in "ladders".`,
        `Add "${adapter.ladder}" to "ladders", or fix "${adapter.name}"'s "ladder" reference.`,
        recommendations,
      );
      continue;
    }
    if (!ladder.levels.some((l) => l.id === adapter.claimedLevel)) {
      pushFinding(
        findings, 'high', 'unknown-claimed-level',
        `Adapter "${adapter.name}" claims level "${adapter.claimedLevel}", which ladder "${adapter.ladder}" does not define.`,
        `Fix "${adapter.name}"'s claimedLevel to a level id that actually exists on "${adapter.ladder}".`,
        recommendations,
      );
    }

    const seenKinds = new Set();
    for (const probe of adapter.negativeProbes) {
      if (seenKinds.has(probe.kind)) {
        pushFinding(
          findings, 'medium', 'duplicate-negative-probe',
          `Adapter "${adapter.name}" declares more than one "${probe.kind}" negative probe.`,
          `Keep exactly one fixture per probe kind per adapter; merge or remove the duplicate "${probe.kind}" entry for "${adapter.name}".`,
          recommendations,
        );
      }
      seenKinds.add(probe.kind);
    }

    for (const kind of REQUIRED_PROBE_KINDS) {
      const probe = adapter.negativeProbes.find((p) => p.kind === kind);
      if (!probe || probe.present !== true) {
        pushFinding(
          findings, 'critical', 'missing-negative-probe',
          `Adapter "${adapter.name}" has no falsifiable, daemon-witnessed fixture for the "${kind}" negative probe.`,
          `Wire an actual "${kind}" hostile-probe fixture against "${adapter.name}" and mark it present once the daemon actually runs it.`,
          recommendations,
        );
        continue;
      }
      if (probe.downgraded !== true) {
        pushFinding(
          findings, 'critical', 'no-downgrade-on-forgery',
          `Adapter "${adapter.name}"'s "${kind}" probe fired but did not downgrade the claimed level "${adapter.claimedLevel}" — the adversarial behavior was not caught.`,
          `Fix the daemon-side check so a fired "${kind}" probe against "${adapter.name}" downgrades its effective compliance level.`,
          recommendations,
        );
      }
    }
  }

  // --- 4. Every non-base level must be backed by a witnessed, caught probe --
  for (const ladder of spec.ladders) {
    for (const level of ladder.levels) {
      if (level.order === 0) continue; // base/entry level requires no evidence by definition
      const claimants = spec.adapters.filter((a) => a.ladder === ladder.name && a.claimedLevel === level.id);
      const witnessed = claimants.some((a) =>
        a.negativeProbes.some((p) => p.present === true && p.downgraded === true),
      );
      if (!witnessed) {
        pushFinding(
          findings, 'critical', 'level-advances-on-self-report',
          `Level "${level.id}" ("${level.name}") on ladder "${ladder.name}" is reachable with zero adapters backed by a daemon-witnessed, correctly-downgrading negative probe — nothing but self-report establishes it.`,
          `Add at least one adapter fixture claiming "${level.id}" with a present, honestly-downgrading negative probe before that level can be granted.`,
          recommendations,
        );
      }
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Ladder is identical across every surface and every level is backed by a witnessed, honestly-downgrading negative probe. Safe to freeze and ship C-badges/T-labels.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: conformance_audit.mjs --input <conformance-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditConformance(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`conformance_audit: ${error.message}\n`);
    process.exit(1);
  }
}
