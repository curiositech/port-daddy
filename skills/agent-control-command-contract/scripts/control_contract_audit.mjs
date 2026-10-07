#!/usr/bin/env node
// Static audit of a declared operator-control contract. This checks declarations
// for internal completeness and consistency; it does not probe an adapter,
// verify a live authority source, or prove that a UI is safe to enable.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIFECYCLE_STATES = Object.freeze([
  'requested',
  'policy-denied',
  'queued',
  'delivered',
  'acknowledged',
  'effect-observed',
  'failed',
  'expired-before-delivery',
  'outcome-unknown',
  'unsupported',
]);

const SUPPORTED_MINIMUM = Object.freeze([
  'requested', 'policy-denied', 'delivered', 'acknowledged',
  'effect-observed', 'failed', 'expired-before-delivery', 'outcome-unknown',
]);
const UNSUPPORTED_MINIMUM = Object.freeze(['requested', 'policy-denied', 'unsupported']);
const AUTH_SOURCES = Object.freeze(['lease-store', 'event-store', 'policy-service', 'cached-projection', 'ui-state']);
const AUTH_BINDINGS = Object.freeze(['principal', 'target', 'scope', 'policyRevision', 'expiresAt', 'fencingEpoch']);
const AUTH_CHECKS = Object.freeze(['principal', 'target', 'scope', 'currentPolicy', 'notExpired', 'fencingEpoch']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
}

function requireKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${path}.${key} is an unknown property`);
  }
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string`);
}

function requireStringArray(value, path, { nonEmpty = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${nonEmpty ? 'a non-empty' : 'an'} array of strings`);
  }
  value.forEach((item, i) => requireString(item, `${path}[${i}]`));
}

function requireUnique(values, path) {
  const seen = new Set();
  values.forEach((value, i) => {
    if (seen.has(value)) throw new TypeError(`${path}[${i}] duplicates "${value}"`);
    seen.add(value);
  });
}

function validateInputShape(spec) {
  requireRecord(spec, 'input');
  requireKeys(spec, ['$schema', 'profile', 'verbs', 'backends', 'authorization', 'matrix'], 'input');
  if ('$schema' in spec && spec.$schema !== '../schemas/control-contract.schema.json') throw new TypeError('input.$schema must name ../schemas/control-contract.schema.json');
  requireRecord(spec.profile, 'profile');
  requireKeys(spec.profile, ['id', 'name', 'basis', 'requiredVerbs', 'requiredLifecycleStates'], 'profile');
  requireString(spec.profile.id, 'profile.id');
  requireString(spec.profile.name, 'profile.name');
  requireString(spec.profile.basis, 'profile.basis');
  requireStringArray(spec.profile.requiredVerbs, 'profile.requiredVerbs');
  requireUnique(spec.profile.requiredVerbs, 'profile.requiredVerbs');
  requireStringArray(spec.profile.requiredLifecycleStates, 'profile.requiredLifecycleStates');
  requireUnique(spec.profile.requiredLifecycleStates, 'profile.requiredLifecycleStates');

  if (!Array.isArray(spec.verbs) || spec.verbs.length === 0) throw new TypeError('verbs must be a non-empty array');
  spec.verbs.forEach((verb, i) => {
    requireRecord(verb, `verbs[${i}]`);
    requireKeys(verb, ['name', 'intent'], `verbs[${i}]`);
    requireString(verb.name, `verbs[${i}].name`);
    requireString(verb.intent, `verbs[${i}].intent`);
  });
  requireUnique(spec.verbs.map((v) => v.name), 'verbs[].name');

  if (!Array.isArray(spec.backends) || spec.backends.length === 0) throw new TypeError('backends must be a non-empty array');
  spec.backends.forEach((backend, i) => {
    requireRecord(backend, `backends[${i}]`);
    requireKeys(backend, ['name', 'description', 'supportedVerbs'], `backends[${i}]`);
    requireString(backend.name, `backends[${i}].name`);
    requireString(backend.description, `backends[${i}].description`);
    requireStringArray(backend.supportedVerbs, `backends[${i}].supportedVerbs`, { nonEmpty: false });
    requireUnique(backend.supportedVerbs, `backends[${i}].supportedVerbs`);
  });
  requireUnique(spec.backends.map((b) => b.name), 'backends[].name');

  requireRecord(spec.authorization, 'authorization');
  requireKeys(spec.authorization, ['source', 'checkedAtAdmission', 'bindings', 'checks'], 'authorization');
  requireString(spec.authorization.source, 'authorization.source');
  if (!AUTH_SOURCES.includes(spec.authorization.source)) {
    throw new TypeError(`authorization.source must be one of ${AUTH_SOURCES.join(', ')}`);
  }
  if (typeof spec.authorization.checkedAtAdmission !== 'boolean') {
    throw new TypeError('authorization.checkedAtAdmission must be a boolean');
  }
  requireRecord(spec.authorization.bindings, 'authorization.bindings');
  requireKeys(spec.authorization.bindings, AUTH_BINDINGS, 'authorization.bindings');
  for (const name of AUTH_BINDINGS) requireString(spec.authorization.bindings[name], `authorization.bindings.${name}`);
  requireRecord(spec.authorization.checks, 'authorization.checks');
  requireKeys(spec.authorization.checks, AUTH_CHECKS, 'authorization.checks');
  for (const name of AUTH_CHECKS) {
    if (typeof spec.authorization.checks[name] !== 'boolean') {
      throw new TypeError(`authorization.checks.${name} must be a boolean`);
    }
  }

  if (!Array.isArray(spec.matrix)) throw new TypeError('matrix must be an array');
  spec.matrix.forEach((cell, i) => {
    requireRecord(cell, `matrix[${i}]`);
    requireKeys(cell, ['verb', 'backend', 'support', 'lifecycleStates'], `matrix[${i}]`);
    requireString(cell.verb, `matrix[${i}].verb`);
    requireString(cell.backend, `matrix[${i}].backend`);
    if (cell.support !== 'supported' && cell.support !== 'unsupported') {
      throw new TypeError(`matrix[${i}].support must be "supported" or "unsupported"`);
    }
    requireStringArray(cell.lifecycleStates, `matrix[${i}].lifecycleStates`);
    requireUnique(cell.lifecycleStates, `matrix[${i}].lifecycleStates`);
  });
}

function finding(findings, code, message) {
  findings.push({ severity: 'critical', code, message });
}

/**
 * Return whether a declared contract is internally complete. `declarationPass`
 * is deliberately not runtime evidence or authorization to render UI controls.
 */
export function auditControlContract(spec) {
  validateInputShape(spec);
  const findings = [];
  const verbNames = spec.verbs.map((v) => v.name);
  const backendNames = spec.backends.map((b) => b.name);
  const verbSet = new Set(verbNames);
  const backendByName = new Map(spec.backends.map((b) => [b.name, b]));
  const matrixByPair = new Map();
  const source = spec.authorization.source;

  for (const requiredVerb of spec.profile.requiredVerbs) {
    if (!verbSet.has(requiredVerb)) {
      finding(findings, 'required-verb-missing', `Profile requires "${requiredVerb}", but it has no verb declaration.`);
    }
  }
  for (const state of spec.profile.requiredLifecycleStates) {
    if (!LIFECYCLE_STATES.includes(state)) {
      finding(findings, 'unknown-profile-lifecycle-state', `Profile declares unknown lifecycle state "${state}".`);
    }
  }
  for (const requiredState of SUPPORTED_MINIMUM) {
    if (!spec.profile.requiredLifecycleStates.includes(requiredState)) {
      finding(findings, 'profile-lifecycle-distinction-missing', `Profile must distinguish "${requiredState}" for supported commands.`);
    }
  }
  if (spec.profile.requiredLifecycleStates.includes('unsupported')) {
    finding(findings, 'unsupported-not-supported-lifecycle', 'unsupported is a capability result for an unsupported pair, not a required state of supported pairs.');
  }

  for (const backend of spec.backends) {
    for (const supportedName of backend.supportedVerbs) {
      if (!verbSet.has(supportedName)) {
        finding(findings, 'undeclared-supported-verb', `Backend "${backend.name}" lists undeclared supported verb "${supportedName}".`);
      }
    }
  }

  for (const cell of spec.matrix) {
    const key = JSON.stringify([cell.verb, cell.backend]);
    if (matrixByPair.has(key)) {
      finding(findings, 'duplicate-matrix-pair', `Matrix contains more than one row for ${cell.verb}/${cell.backend}; duplicate rows may not contradict each other.`);
      const prior = matrixByPair.get(key);
      if (prior.support !== cell.support || JSON.stringify(prior.lifecycleStates) !== JSON.stringify(cell.lifecycleStates)) {
        finding(findings, 'contradictory-matrix-duplicate', `Repeated rows for ${cell.verb}/${cell.backend} declare different support or lifecycle states.`);
      }
    } else {
      matrixByPair.set(key, cell);
    }
    if (!verbSet.has(cell.verb)) finding(findings, 'undeclared-matrix-verb', `Matrix references undeclared verb "${cell.verb}".`);
    if (!backendByName.has(cell.backend)) finding(findings, 'undeclared-matrix-backend', `Matrix references undeclared backend "${cell.backend}".`);
    for (const state of cell.lifecycleStates) {
      if (!LIFECYCLE_STATES.includes(state)) finding(findings, 'unknown-lifecycle-state', `Matrix ${cell.verb}/${cell.backend} uses unknown lifecycle state "${state}".`);
    }
  }

  for (const verbName of verbNames) {
    for (const backendName of backendNames) {
      const cell = matrixByPair.get(JSON.stringify([verbName, backendName]));
      if (!cell) {
        finding(findings, 'matrix-pair-missing', `Matrix is missing the declared pair ${verbName}/${backendName}.`);
        continue;
      }
      const backend = backendByName.get(backendName);
      const listedSupported = backend.supportedVerbs.includes(verbName);
      const expectedSupport = listedSupported ? 'supported' : 'unsupported';
      if (cell.support !== expectedSupport) {
        finding(findings, 'matrix-support-contradiction', `${verbName}/${backendName} is "${cell.support}" in matrix but backend.supportedVerbs implies "${expectedSupport}".`);
      }
      if (cell.support === 'supported') {
        for (const state of SUPPORTED_MINIMUM) {
          if (!cell.lifecycleStates.includes(state)) finding(findings, 'supported-lifecycle-gap', `Supported pair ${verbName}/${backendName} does not declare "${state}".`);
        }
        for (const state of spec.profile.requiredLifecycleStates) {
          if (!cell.lifecycleStates.includes(state)) finding(findings, 'profile-lifecycle-gap', `Supported pair ${verbName}/${backendName} does not declare profile-required state "${state}".`);
        }
        if (cell.lifecycleStates.includes('unsupported')) {
          finding(findings, 'supported-pair-marked-unsupported', `Supported pair ${verbName}/${backendName} also declares unsupported.`);
        }
      } else {
        for (const state of UNSUPPORTED_MINIMUM) {
          if (!cell.lifecycleStates.includes(state)) finding(findings, 'unsupported-lifecycle-gap', `Unsupported pair ${verbName}/${backendName} does not declare "${state}".`);
        }
        for (const state of ['queued', 'delivered', 'acknowledged', 'effect-observed', 'failed', 'expired-before-delivery', 'outcome-unknown']) {
          if (cell.lifecycleStates.includes(state)) finding(findings, 'unsupported-pair-has-effect-state', `Unsupported pair ${verbName}/${backendName} also claims "${state}".`);
        }
      }
    }
  }

  for (const requiredVerb of spec.profile.requiredVerbs) {
    if (verbSet.has(requiredVerb) && !spec.backends.some((backend) => backend.supportedVerbs.includes(requiredVerb))) {
      finding(findings, 'required-verb-no-supporting-backend', `Profile requires "${requiredVerb}", but no declared backend supports it.`);
    }
  }

  if (source === 'cached-projection' || source === 'ui-state') {
    finding(findings, 'stale-authorization-source', `authorization source "${source}" cannot authorize a command.`);
  }
  if (spec.authorization.checkedAtAdmission !== true) {
    finding(findings, 'authorization-not-rechecked', 'Authorization is not declared as rechecked at effect admission.');
  }
  for (const name of AUTH_CHECKS) {
    if (spec.authorization.checks[name] !== true) finding(findings, 'authorization-binding-gap', `Admission declaration does not check ${name}.`);
  }

  return {
    declarationPass: findings.length === 0,
    scope: 'static declaration completeness only; runtime evidence not assessed',
    safeToRenderControls: false,
    findings,
    recommendations: findings.length === 0
      ? ['Declaration is internally complete. Collect adapter, authority-boundary, effect-observation, and UI evidence before enabling controls.']
      : ['Repair every reported declaration gap, then separately test the adapter, authority boundary, effect observation, expiry, and UI gating.'],
  };
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) {
    throw new Error('usage: control_contract_audit.mjs --input <spec>.json');
  }
  return { input: argv[1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    const result = auditControlContract(spec);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.declarationPass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`control_contract_audit: ${error.message}\n`);
    process.exitCode = 1;
  }
}
