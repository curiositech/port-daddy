#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_SCHEMA = JSON.parse(readFileSync(new URL('../schemas/infra-plan.schema.json', import.meta.url), 'utf8'));
const REQUIRED_GATES = PLAN_SCHEMA.required;
const REQUIRED_METRICS = ['task-success', 'unauthorized-effects', 'duplicate-effects', 'latency', 'provider-cost', 'infrastructure-cost', 'human-review-time', 'restart-recovery', 'maintenance-cost'];
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

function inspectJsonValue(value, path, errors, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push({ path, message: 'JSON numbers must be finite' });
    return;
  }
  if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)) {
    errors.push({ path, message: `${typeof value} is not a JSON value` });
    return;
  }
  if (typeof value !== 'object') {
    errors.push({ path, message: 'value is not JSON-compatible' });
    return;
  }
  let added = false;
  try {
    if (ancestors.has(value)) { errors.push({ path, message: 'cyclic reference is not a JSON value' }); return; }
    ancestors.add(value);
    added = true;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      errors.push({ path, message: 'only plain objects are accepted' });
      return;
    }
    const keys = Reflect.ownKeys(value);
    const valueKeys = array ? keys.filter((key) => key !== 'length') : keys;
    if (array) {
      const indexes = valueKeys.filter((key) => typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length);
      if (indexes.length !== value.length || indexes.length !== valueKeys.length) errors.push({ path, message: 'arrays must be dense and have no custom or symbol properties' });
    }
    for (const key of valueKeys) {
      if (typeof key !== 'string') { errors.push({ path, message: 'symbol-keyed properties are not JSON values' }); continue; }
      if (array && !(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)) continue;
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch { errors.push({ path: `${path}.${key}`, message: 'property cannot be inspected' }); continue; }
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        errors.push({ path: `${path}.${key}`, message: 'JSON values require enumerable data properties without accessors' });
        continue;
      }
      inspectJsonValue(descriptor.value, array ? `${path}[${key}]` : `${path}.${key}`, errors, ancestors);
    }
  } catch (error) {
    errors.push({ path, message: `value cannot be inspected as JSON: ${error.message}` });
  } finally {
    try { if (added) ancestors.delete(value); } catch { /* keep malformed proxies fail-closed */ }
  }
}

function validateSchema(value, schema, path, errors) {
  const type = schema.type;
  const matches = type === 'object' ? isPlainObject(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'boolean' ? typeof value === 'boolean'
          : type === 'integer' ? Number.isInteger(value) && Number.isFinite(value)
            : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
              : true;
  if (!matches) { errors.push({ path, message: `expected ${type}` }); return; }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `must have at least ${schema.minLength} characters` });
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push({ path, message: `must match ${schema.pattern}` });
  if (typeof value === 'string' && schema.format === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const year = match ? Number(match[1]) : 0;
    const month = match ? Number(match[2]) : 0;
    const day = match ? Number(match[3]) : 0;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const validDate = Boolean(match) && year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
    if (!validDate) errors.push({ path, message: 'must be a valid ISO 8601 calendar date (YYYY-MM-DD)' });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be <= ${schema.maximum}` });
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push({ path, message: `must be one of: ${schema.enum.join(', ')}` });
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `must contain at least ${schema.minItems} item(s)` });
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => { const key = JSON.stringify(item); if (seen.has(key)) errors.push({ path: `${path}[${index}]`, message: 'duplicate item' }); seen.add(key); });
    }
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`, errors));
  }
  if (isPlainObject(value)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push({ path: `${path}.${required}`, message: 'required field is missing' });
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${path}.${key}`, errors);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push({ path: `${path}.${key}`, message: 'additional property is not allowed' });
  }
}
function add(findings, id, path, message) { findings.push({ id, path, severity: 'blocking', message }); }
function uniqueValues(items, key) { return Array.isArray(items) ? items.map((item) => item?.[key]).filter((value) => typeof value === 'string') : []; }

function semanticChecks(plan, findings) {
  if (!isPlainObject(plan)) return;
  const framework = plan.framework;
  if (isPlainObject(framework)) {
    const candidateNames = uniqueValues(framework.candidates, 'name');
    if (new Set(candidateNames).size !== candidateNames.length) add(findings, 'duplicate-candidate', 'framework.candidates', 'Candidate names must be unique.');
    if (framework.selectionStatus === 'selected' && (!isNonEmptyString(framework.selectedCandidate) || !candidateNames.includes(framework.selectedCandidate))) add(findings, 'selected-candidate-unresolved', 'framework.selectedCandidate', 'A selected decision must name one candidate declared in framework.candidates.');
    if (framework.selectionStatus === 'deferred' && Object.hasOwn(framework, 'selectedCandidate')) add(findings, 'deferred-with-selection', 'framework.selectedCandidate', 'Remove selectedCandidate while the decision status is deferred.');
  }
  const evaluation = plan.evaluation;
  if (isPlainObject(evaluation)) {
    const tasks = uniqueValues(evaluation.taskSet, 'taskId');
    if (new Set(tasks).size !== tasks.length) add(findings, 'duplicate-task-id', 'evaluation.taskSet', 'Task IDs must be unique so denominators and results can be joined.');
    const names = uniqueValues(evaluation.metrics, 'name');
    if (new Set(names).size !== names.length) add(findings, 'duplicate-metric', 'evaluation.metrics', 'Metric names must be unique.');
    for (const name of REQUIRED_METRICS) if (!names.includes(name)) add(findings, 'missing-evaluation-metric', 'evaluation.metrics', `Record ${name}, or explicitly mark it not applicable with a rationale.`);
    for (const [index, metric] of (Array.isArray(evaluation.metrics) ? evaluation.metrics : []).entries()) {
      if (isPlainObject(metric) && metric.applicability === 'applicable' && !isNonEmptyString(metric.measurement)) add(findings, 'metric-without-measurement', `evaluation.metrics[${index}].measurement`, 'Applicable metrics require a measurement method.');
    }
    if (evaluation.status === 'observed' && (!isNonEmptyString(evaluation.resultRef) || evaluation.resultRef === 'not-run')) add(findings, 'observed-without-result', 'evaluation.resultRef', 'Observed status requires a result artifact reference; a plan or placeholder is not a result.');
  }
  for (const [key, requiredFields] of [['security', ['threats', 'controls']], ['incidentResponse', ['failureScenarios', 'containment', 'recovery']]]) {
    const section = plan[key];
    if (!isPlainObject(section)) continue;
    if (section.applicability === 'required') for (const field of requiredFields) if (!Array.isArray(section[field]) || section[field].length === 0) add(findings, `missing-${key}-${field}`, `${key}.${field}`, `Required ${key} assessment needs at least one ${field} entry.`);
    if (section.applicability === 'not-applicable' && (!isNonEmptyString(section.rationale) || section.rationale.trim().length < 20)) add(findings, `${key}-inapplicability-unjustified`, `${key}.rationale`, 'Not-applicable requires a scope-specific rationale of at least 20 characters.');
    if (['implemented', 'tested'].includes(section.status) && (!Array.isArray(section.evidenceRefs) || section.evidenceRefs.length === 0)) add(findings, `${key}-claim-without-evidence-ref`, `${key}.evidenceRefs`, 'Implementation or test status requires a reference to reviewable evidence; the auditor does not verify that evidence.');
  }
  const cost = plan.cost;
  if (isPlainObject(cost)) {
    if (cost.applicability === 'unknown') add(findings, 'cost-applicability-unknown', 'cost.applicability', 'Resolve whether the workload incurs provider spend; unknown cost applicability cannot pass.');
    if (cost.applicability === 'provider-spend') {
      if (!Number.isFinite(cost.perTaskCapUsd) || cost.perTaskCapUsd <= 0) add(findings, 'missing-per-task-cap', 'cost.perTaskCapUsd', 'Provider spend requires a finite positive per-task cap.');
      if (!isNonEmptyString(cost.pricingEvidence)) add(findings, 'missing-pricing-source', 'cost.pricingEvidence', 'Record the provider/model pricing source and checked date.');
    } else if (cost.applicability === 'no-provider-spend') {
      if (Object.hasOwn(cost, 'perTaskCapUsd')) add(findings, 'cap-with-no-provider-spend', 'cost.perTaskCapUsd', 'Remove perTaskCapUsd or classify provider spending accurately.');
      if (!isNonEmptyString(cost.rationale) || cost.rationale.trim().length < 20) add(findings, 'cost-exemption-unjustified', 'cost.rationale', 'No-provider-spend requires a scope-specific rationale.');
    }
  }
  const observability = plan.observability;
  if (isPlainObject(observability) && observability.applicability === 'required' && (!Array.isArray(observability.levels) || observability.levels.length === 0)) add(findings, 'missing-observability-level', 'observability.levels', 'Required observability must name at least one level and its retention.');
  const policy = plan.effectPolicy;
  if (isPlainObject(policy) && Array.isArray(policy.effects)) {
    const declaredEffects = Array.isArray(plan.workload?.effectClasses) ? plan.workload.effectClasses : [];
    const policyCounts = new Map();
    for (const [index, effect] of policy.effects.entries()) {
      if (!isPlainObject(effect)) continue;
      if (typeof effect.effectClass === 'string') policyCounts.set(effect.effectClass, (policyCounts.get(effect.effectClass) ?? 0) + 1);
      const highImpact = ['externally-visible-effect', 'irreversible-effect'].includes(effect.effectClass);
      if (highImpact && effect.approval === 'none') add(findings, 'unbounded-effect-policy', `effectPolicy.effects[${index}].approval`, 'Externally visible or irreversible effects require a named human or scoped service authorization rule.');
      if (highImpact && effect.idempotency === 'not-applicable') add(findings, 'effect-replay-unaddressed', `effectPolicy.effects[${index}].idempotency`, 'Externally visible or irreversible effects need a replay/duplicate policy.');
    }
    for (const effectClass of new Set(declaredEffects)) {
      const count = policyCounts.get(effectClass) ?? 0;
      if (count === 0) add(findings, 'effect-policy-missing', 'effectPolicy.effects', `Declared workload effect class '${effectClass}' needs exactly one policy record.`);
      if (count > 1) add(findings, 'effect-policy-duplicate', 'effectPolicy.effects', `Declared workload effect class '${effectClass}' has more than one policy record.`);
    }
    for (const effectClass of policyCounts.keys()) if (!declaredEffects.includes(effectClass)) add(findings, 'effect-policy-undeclared', 'effectPolicy.effects', `Policy class '${effectClass}' is not declared by the workload.`);
  }
  const mcp = plan.mcp;
  if (isPlainObject(mcp) && mcp.used === true) {
    if (!isNonEmptyString(mcp.protocolVersion)) add(findings, 'mcp-version-missing', 'mcp.protocolVersion', 'Record the MCP protocol revision actually planned.');
    if (Object.hasOwn(mcp, 'contextOverheadPct') && !isNonEmptyString(mcp.measurementRef)) add(findings, 'mcp-overhead-without-measurement', 'mcp.measurementRef', 'A context-overhead value needs a measurement reference.');
  }
  const memory = plan.memory;
  if (isPlainObject(memory) && memory.used === true) {
    if (!Array.isArray(memory.layers) || memory.layers.length === 0) add(findings, 'memory-layers-missing', 'memory.layers', 'When memory is used, name the actual layer(s).');
    if (!isNonEmptyString(memory.retention) || !isNonEmptyString(memory.deletionMethod)) add(findings, 'memory-lifecycle-missing', 'memory', 'Memory use requires retention and deletion descriptions.');
  }
  const performance = plan.performance;
  if (isPlainObject(performance) && performance.applicability === 'required') {
    const objective = (Number.isFinite(performance.latencyObjectiveMs) && performance.latencyObjectiveMs > 0) || isNonEmptyString(performance.throughputObjective);
    if (!objective || !isNonEmptyString(performance.measurementRef)) add(findings, 'performance-objective-incomplete', 'performance', 'A required performance target needs a local objective and measurement plan.');
  }
  const returnModel = plan.returnModel;
  if (isPlainObject(returnModel) && returnModel.applicability === 'planned' && (!Array.isArray(returnModel.baselineMetrics) || returnModel.baselineMetrics.length === 0 || !isNonEmptyString(returnModel.timeWindow) || !Array.isArray(returnModel.includedCosts) || returnModel.includedCosts.length === 0)) add(findings, 'return-model-incomplete', 'returnModel', 'A planned return model needs baseline metrics, time window, and included costs.');
}

/** Static declaration check only. A pass is not deployment or readiness evidence. */
export function auditInfraReadiness(plan) {
  const findings = [];
  const jsonErrors = [];
  try { inspectJsonValue(plan, '$', jsonErrors); }
  catch (error) { jsonErrors.push({ path: '$', message: `value cannot be inspected as JSON: ${error.message}` }); }
  findings.push(...jsonErrors.map((error, index) => ({ id: `schema-json-${index + 1}`, path: error.path, severity: 'blocking', message: error.message })));
  if (findings.length === 0) {
    const errors = [];
    validateSchema(plan, PLAN_SCHEMA, '$', errors);
    findings.push(...errors.map((error, index) => ({ id: `schema-${index + 1}`, path: error.path, severity: 'blocking', message: error.message })));
    semanticChecks(plan, findings);
  }
  return { pass: findings.length === 0, status: findings.length === 0 ? 'PLAN_DECLARATIONS_COMPLETE' : 'NEEDS_REVISION', evidenceBoundary: 'Static declaration check only; does not verify source references, enforcement, deployment, safety, performance, or ROI.', findings };
}
export { PLAN_SCHEMA, REQUIRED_GATES };

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const index = argv.indexOf('--input');
  if (index === -1 || !argv[index + 1]) throw new Error('usage: node scripts/infra_readiness.mjs --input <plan.json>');
  return { input: argv[index + 1] };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write('usage: node scripts/infra_readiness.mjs --input <plan.json>\n');
    else {
      const data = JSON.parse(readFileSync(resolve(options.input), 'utf8'));
      const result = auditInfraReadiness(data);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`infra_readiness: ${error.message}\n`);
    process.exitCode = 1;
  }
}
