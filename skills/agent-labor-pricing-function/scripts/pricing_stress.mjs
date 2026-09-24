#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = new Set(['per-seat', 'metered', 'credits', 'hybrid', 'outcome']);
const USAGE_EXPOSED = new Set(['metered', 'credits', 'hybrid', 'outcome']);
const GUARDRAIL_KEYS = ['spendCap', 'budgetPreview', 'perTaskEstimate', 'transparentMetering'];
const OUTCOME_POLICIES = new Set(['do-not-bill', 'hold-for-review']);

function object(value, name, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${name} has unsupported property "${key}"`);
  return value;
}
function array(value, name) { if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty array`); return value; }
function string(value, name) { if (typeof value !== 'string' || !/\S/.test(value)) throw new Error(`${name} must be a non-empty non-whitespace string`); return value.trim(); }
function number(value, name, { max = Infinity } = {}) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name} must be a finite number from 0 to ${max === Infinity ? 'Infinity' : max}`); return value; }
function boolean(value, name) { if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`); return value; }
function computed(value, name) { if (!Number.isFinite(value)) throw new Error(`${name} produced non-finite derived arithmetic`); return value; }
function usd(value) { return `$${value.toFixed(6)}`; }

function parseOutcomeSettlement(value) {
  if (value === undefined) return null;
  const settlement = object(value, 'plan.outcomeSettlement', ['verifier', 'unknownResult']);
  return { verifier: string(settlement.verifier, 'plan.outcomeSettlement.verifier'), unknownResult: string(settlement.unknownResult, 'plan.outcomeSettlement.unknownResult') };
}

/**
 * Deterministically evaluates declared draft inputs. It is intentionally two-level:
 * malformed shapes throw; well-formed but policy-incomplete drafts return status "blocked".
 * It performs no billing, provider call, or runtime enforcement.
 */
export function stressPricingPlan(plan) {
  object(plan, 'plan', ['model', 'valueMetric', 'unitCosts', 'targetMarginPct', 'pricePoints', 'guardrails', 'personas', 'outcomeSettlement']);
  const model = string(plan.model, 'plan.model');
  if (!MODELS.has(plan.model)) throw new Error(`plan.model must be one of ${[...MODELS].join(', ')}`);
  const valueMetric = object(plan.valueMetric, 'plan.valueMetric', ['name', 'unit', 'buyerCanPredict', 'description']);
  const metric = { name: string(valueMetric.name, 'plan.valueMetric.name'), unit: string(valueMetric.unit, 'plan.valueMetric.unit'), buyerCanPredict: boolean(valueMetric.buyerCanPredict, 'plan.valueMetric.buyerCanPredict') };
  if (valueMetric.description !== undefined) string(valueMetric.description, 'plan.valueMetric.description');
  const costs = object(plan.unitCosts, 'plan.unitCosts', ['modelTokenCost', 'toolCompute', 'overhead']);
  const modelTokenCost = number(costs.modelTokenCost, 'plan.unitCosts.modelTokenCost');
  const toolCompute = number(costs.toolCompute, 'plan.unitCosts.toolCompute');
  const overhead = number(costs.overhead, 'plan.unitCosts.overhead');
  const totalUnitCost = computed(modelTokenCost + toolCompute + overhead, 'plan.unitCosts total');
  const targetMarginPct = plan.targetMarginPct === undefined ? 0.3 : number(plan.targetMarginPct, 'plan.targetMarginPct', { max: 1 });

  const tierMap = new Map();
  for (const [i, raw] of array(plan.pricePoints, 'plan.pricePoints').entries()) {
    object(raw, `plan.pricePoints[${i}]`, ['tier', 'basePrice', 'includedUnits', 'overageRatePerUnit']);
    const tier = string(raw.tier, `plan.pricePoints[${i}].tier`);
    if (tierMap.has(tier)) throw new Error(`plan.pricePoints has duplicate tier "${tier}"`);
    tierMap.set(tier, { tier, basePrice: number(raw.basePrice, `plan.pricePoints[${i}].basePrice`), includedUnits: number(raw.includedUnits, `plan.pricePoints[${i}].includedUnits`), overageRatePerUnit: raw.overageRatePerUnit === undefined ? undefined : number(raw.overageRatePerUnit, `plan.pricePoints[${i}].overageRatePerUnit`) });
  }

  const guardrails = object(plan.guardrails, 'plan.guardrails', GUARDRAIL_KEYS);
  const resolved = Object.fromEntries(GUARDRAIL_KEYS.map((key) => [key, boolean(guardrails[key], `plan.guardrails.${key}`)]));
  const usageExposed = USAGE_EXPOSED.has(model);
  const missingGuardrails = usageExposed ? GUARDRAIL_KEYS.filter((key) => !resolved[key]) : [];
  const outcomeSettlement = parseOutcomeSettlement(plan.outcomeSettlement);

  const findings = [], recommendations = [], marginByPersona = [];
  let riskPoints = 0;
  let hasMarginFloorFailure = false, hasAmbiguousExcess = false, hasOutcomePolicyFailure = false;
  if (!metric.buyerCanPredict) { riskPoints += 2; findings.push(`Value metric "${metric.name}" is not buyer-predictable before commitment.`); recommendations.push('Choose a countable buyer-facing unit, then retain raw infrastructure measures in the cost ledger.'); }
  for (const key of missingGuardrails) { riskPoints += key === 'spendCap' || key === 'budgetPreview' ? 2 : 1; findings.push(`Missing required guardrail "${key}" on a ${model} plan.`); }
  if (missingGuardrails.length) recommendations.push('Add every required guardrail before treating a usage-exposed plan as passable.');
  if (model === 'outcome' && !outcomeSettlement) { hasOutcomePolicyFailure = true; riskPoints += 2; findings.push('Outcome pricing has no verifier and unknown-result policy.'); recommendations.push('Name an outcome verifier and select do-not-bill or hold-for-review for unknown results.'); }
  if (model === 'outcome' && outcomeSettlement && !OUTCOME_POLICIES.has(outcomeSettlement.unknownResult)) { hasOutcomePolicyFailure = true; riskPoints += 2; findings.push(`Unknown outcome policy "${outcomeSettlement.unknownResult}" is not supported.`); recommendations.push('Use do-not-bill or hold-for-review until a different policy is specified and reviewed.'); }

  const personaNames = new Set();
  for (const [i, raw] of array(plan.personas, 'plan.personas').entries()) {
    object(raw, `plan.personas[${i}]`, ['name', 'tier', 'monthlyUnits']);
    const name = string(raw.name, `plan.personas[${i}].name`), tierName = string(raw.tier, `plan.personas[${i}].tier`), monthlyUnits = number(raw.monthlyUnits, `plan.personas[${i}].monthlyUnits`);
    if (personaNames.has(name)) throw new Error(`plan.personas has duplicate name "${name}"`);
    personaNames.add(name);
    const tier = tierMap.get(tierName); if (!tier) throw new Error(`plan.personas[${i}] references unknown tier "${tierName}"`);
    const overageUnits = computed(Math.max(0, monthlyUnits - tier.includedUnits), `${name} overage units`);
    const ambiguousExcess = overageUnits > 0 && tier.overageRatePerUnit === undefined;
    const overageRevenue = ambiguousExcess ? 0 : computed(overageUnits * (tier.overageRatePerUnit ?? 0), `${name} overage revenue`);
    const revenue = computed(tier.basePrice + overageRevenue, `${name} revenue`);
    const cost = computed(totalUnitCost * monthlyUnits, `${name} cost`);
    const margin = computed(revenue - cost, `${name} margin`);
    const marginPct = computed(revenue > 0 ? margin / revenue : cost > 0 ? -1 : 0, `${name} margin percent`);
    const marginPercentage = computed(marginPct * 100, `${name} margin percentage points`);
    const status = margin < 0 ? 'negative' : marginPct < targetMarginPct ? 'thin' : 'healthy';
    marginByPersona.push({ name, tier: tierName, monthlyUnits, overageUnits, revenue, cost, margin, marginPct: marginPercentage, status, display: { revenueUsd: usd(revenue), costUsd: usd(cost), marginUsd: usd(margin), marginPct: `${marginPercentage.toFixed(2)}%` } });
    if (status === 'negative') { hasMarginFloorFailure = true; riskPoints += 3; findings.push(`${name}: NEGATIVE margin (${usd(margin)}) at ${monthlyUnits} ${metric.unit}/month.`); recommendations.push(`Raise the price floor, reduce included work, or define a viable excess-use rate for tier "${tierName}".`); }
    else if (status === 'thin') { hasMarginFloorFailure = true; riskPoints += 1; findings.push(`${name}: thin margin (${marginPercentage.toFixed(2)}%), below the ${(targetMarginPct * 100).toFixed(2)}% target.`); recommendations.push(`Revise the price, included work, or target margin assumption for persona "${name}".`); }
    if (ambiguousExcess) { hasAmbiguousExcess = true; riskPoints += 1; findings.push(`${name}: exceeds included units without an explicit excess-use treatment.`); recommendations.push(`Set an explicit overageRatePerUnit for tier "${tierName}"; 0 is an explicit free-excess decision.`); }
  }
  const level = riskPoints === 0 ? 'none' : riskPoints <= 2 ? 'low' : riskPoints <= 4 ? 'medium' : 'high';
  const policyBlocks = { predictableValueMetric: !metric.buyerCanPredict, requiredGuardrails: missingGuardrails.length > 0, marginFloor: hasMarginFloorFailure, explicitExcessTreatment: hasAmbiguousExcess, outcomeSettlement: hasOutcomePolicyFailure };
  const pass = !Object.values(policyBlocks).some(Boolean);
  if (recommendations.length === 0) recommendations.push('Declared personas clear the configured margin floor and policy checks; rerun when a declared assumption changes.');
  return { status: pass ? 'pass' : 'blocked', pass, model, valueMetric: metric, unitCostFloor: { modelTokenCost, toolCompute, overhead, totalUnitCost, display: { modelTokenCostUsd: usd(modelTokenCost), toolComputeUsd: usd(toolCompute), overheadUsd: usd(overhead), totalUnitCostUsd: usd(totalUnitCost) } }, marginByPersona, billShockRisk: { level, riskPoints, requiredGuardrails: usageExposed ? GUARDRAIL_KEYS : [], missingGuardrails }, outcomeSettlement, policyBlocks, findings, recommendations };
}

function parseArgs(argv) {
  let input, status = false, strict = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && input === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) input = argv[++i];
    else if (arg === '--status' && !status) status = true;
    else if (arg === '--strict' && !strict) strict = true;
    else throw new Error('usage: pricing_stress.mjs --input <file>.json [--status] [--strict]');
  }
  if (input === undefined) throw new Error('usage: pricing_stress.mjs --input <file>.json [--status] [--strict]');
  return { input, status, strict };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { const args = parseArgs(process.argv.slice(2)); const report = stressPricingPlan(JSON.parse(readFileSync(args.input, 'utf8'))); process.stdout.write(args.status ? `${report.status}\n` : `${JSON.stringify(report, null, 2)}\n`); if (args.strict && !report.pass) process.exitCode = 2; }
  catch (error) { process.stderr.write(`pricing_stress: ${error.message}\n`); process.exitCode = 1; }
}
