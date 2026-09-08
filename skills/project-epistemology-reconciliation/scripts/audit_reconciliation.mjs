#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import schema from '../schemas/reconciliation-packet.schema.json' with { type: 'json' };

// Deliberately limited to the vocabulary used by this bundled schema.
// This is not a general JSON Schema implementation or an authority verifier.
function validate(value, rule, path = '$') {
  const fail = message => { throw new TypeError(`${path}: ${message}`); };
  if (Object.hasOwn(rule, 'const') && value !== rule.const) fail(`must equal ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`must be one of ${rule.enum.join(', ')}`);
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('must be a plain object');
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule.properties, key)) fail(`unknown property ${key}`);
    }
    for (const [key, childRule] of Object.entries(rule.properties)) {
      if (Object.hasOwn(value, key)) validate(value[key], childRule, `${path}.${key}`);
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (value.length < (rule.minItems ?? 0)) fail(`needs at least ${rule.minItems} items`);
    if (rule.uniqueItems && new Set(value).size !== value.length) fail('items must be unique');
    for (let i = 0; i < value.length; i++) validate(value[i], rule.items, `${path}[${i}]`);
  } else if (rule.type === 'string') {
    if (typeof value !== 'string' || value.trim().length < (rule.minLength ?? 0)) fail('must be a nonblank string');
  } else if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
  } else if (rule.type === 'number' || rule.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
    if (rule.type === 'integer' && !Number.isSafeInteger(value)) fail('must be a safe integer');
    if (value < rule.minimum) fail(`must be at least ${rule.minimum}`);
  }
}

function uniqueMap(items, key, path) {
  const result = new Map();
  for (const item of items) {
    if (result.has(item[key])) throw new TypeError(`${path}: duplicate ${key} ${item[key]}`);
    result.set(item[key], item);
  }
  return result;
}

/** Pure audit of declarations only. It cannot prove evidence or grant permission. */
export function auditThing(spec) {
  validate(spec, schema);
  const evidence = uniqueMap(spec.evidence, 'id', '$.evidence');
  const declaredFindings = uniqueMap(spec.findings, 'id', '$.findings');
  const dissent = uniqueMap(spec.dissent, 'findingId', '$.dissent');
  for (const finding of spec.findings) {
    for (const id of finding.evidenceIds) {
      if (!evidence.has(id)) throw new TypeError(`$.findings.${finding.id}: unknown evidence ${id}`);
    }
  }
  for (const id of dissent.keys()) {
    if (!declaredFindings.has(id)) throw new TypeError(`$.dissent: unknown finding ${id}`);
  }

  const findings = [];
  const add = (id, path, message) => findings.push({ id, path, message });
  const { method, scope, decision, cost, preview } = spec;
  if (decision.halted && (decision.requestedExecution || cost.paidWorkRequested)) {
    add('AP-AUTHORITY', '$.decision.halted', 'The declared operator halt prohibits execution and paid work.');
  }
  if ((decision.status === 'ready' || decision.requestedExecution) && !decision.authorityVerified) {
    add('AP-AUTHORITY', '$.decision.authorityVerified', 'Decision authority has not been declared verified.');
  }
  if (cost.paidWorkRequested && (!cost.telemetryKnown || !cost.aggregateReserved || cost.capUsd <= 0)) {
    add('AP-AUTHORITY', '$.cost', 'Paid work needs known telemetry, an aggregate reservation and a positive cap.');
  }
  for (const item of spec.evidence) {
    if (!item.authorized || item.scopeId !== scope.id) {
      add('AP-AUTHORITY', `$.evidence.${item.id}`, 'Evidence must be declared authorized within this single scope.');
    }
  }
  if ((method.claimsIndependent || method.mode === 'independent') &&
      (method.mode !== 'independent' || !method.sealedBeforeSharing || !method.sameFrozenInput)) {
    add('AP-EVIDENCE', '$.method', 'Independent review requires declared separation and the same frozen input; solo work is not independent.');
  }
  for (const finding of spec.findings) {
    const path = `$.findings.${finding.id}`;
    const premises = finding.evidenceIds.map(id => evidence.get(id));
    if (finding.status === 'verified' && (premises.length === 0 ||
        premises.some(item => item.warrant === 'inference' || item.warrant === 'missing'))) {
      add('AP-EVIDENCE', path, 'A verified finding needs source or observation premises without inferred or missing premises.');
    }
    if (finding.warrant === 'verified_observation' && finding.status !== 'verified') {
      add('AP-EVIDENCE', path, 'An allegation cannot be labeled a verified observation.');
    }
    if (finding.warrant === 'hypothesis' && finding.status === 'verified') {
      add('AP-EVIDENCE', path, 'A hypothesis remains an allegation until its warrant is explicitly revised.');
    }
    if (decision.status === 'ready' && (['open', 'escalate'].includes(finding.disposition) ||
        (finding.blocking && finding.disposition !== 'reject'))) {
      add('AP-RECONCILIATION', path, 'A ready decision cannot retain an open, escalated or active blocking finding.');
    }
    if (finding.disposition === 'reject' && !dissent.has(finding.id)) {
      add('AP-RECONCILIATION', path, 'A rejected finding needs a retained rationale and reopening condition.');
    }
  }
  if (!preview.available || preview.proposalDigest !== decision.proposalDigest ||
      preview.sourceHead !== scope.sourceHead || preview.stateRevision !== scope.revision) {
    add('AP-RECONCILIATION', '$.preview', 'Preview must be available and match the current proposal digest, source head and state revision.');
  }
  const repairs = {
    'AP-AUTHORITY': 'Reconcile halt, audience, decision and aggregate-cost authority using actual evidence; do not execute from this audit.',
    'AP-EVIDENCE': 'Correct warrant or independence claims and inspect their supporting evidence; declarations are not verification.',
    'AP-RECONCILIATION': 'Refresh the preview, resolve or retain open issues honestly, and record rejected alternatives with reopening terms.',
  };
  return {
    pass: findings.length === 0,
    findings,
    recommendations: [...new Set(findings.map(item => repairs[item.id]))],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new TypeError('Usage: node audit_reconciliation.mjs <local-packet.json>');
    const result = auditThing(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Reconciliation audit: ${error.message}\n`);
    process.exitCode = 1;
  }
}
