#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = new Set(['per-seat', 'metered', 'credits', 'hybrid', 'outcome']);
const GUARDRAIL_KEYS = ['spendCap', 'budgetPreview', 'perTaskEstimate', 'transparentMetering'];

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireArray(value, name, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must include at least ${minLength} entr${minLength === 1 ? 'y' : 'ies'}`);
  }
  return value;
}

function requireNonNegativeNumber(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministically stress-tests a pricing plan for agent labor against
 * real unit economics (margin) and bill-shock exposure (guardrails +
 * value-metric predictability). No LLM calls, no keyword matching — every
 * number is computed from the plan's declared unit costs, price points,
 * and persona usage profiles.
 */
export function stressPricingPlan(plan) {
  requireObject(plan, 'plan');

  const model = requireString(plan.model, 'plan.model');
  if (!MODELS.has(model)) {
    throw new Error(`plan.model must be one of ${[...MODELS].join(', ')}, got "${model}"`);
  }

  const valueMetric = requireObject(plan.valueMetric, 'plan.valueMetric');
  requireString(valueMetric.name, 'plan.valueMetric.name');
  requireString(valueMetric.unit, 'plan.valueMetric.unit');
  requireBoolean(valueMetric.buyerCanPredict, 'plan.valueMetric.buyerCanPredict');

  const unitCosts = requireObject(plan.unitCosts, 'plan.unitCosts');
  const modelTokenCost = requireNonNegativeNumber(unitCosts.modelTokenCost, 'plan.unitCosts.modelTokenCost');
  const toolCompute = requireNonNegativeNumber(unitCosts.toolCompute, 'plan.unitCosts.toolCompute');
  const overhead = requireNonNegativeNumber(unitCosts.overhead, 'plan.unitCosts.overhead');
  const totalUnitCost = modelTokenCost + toolCompute + overhead;

  const targetMarginPct =
    plan.targetMarginPct === undefined ? 0.3 : requireNonNegativeNumber(plan.targetMarginPct, 'plan.targetMarginPct');

  const pricePoints = requireArray(plan.pricePoints, 'plan.pricePoints', { minLength: 1 });
  const tierMap = new Map();
  for (const [index, tier] of pricePoints.entries()) {
    requireObject(tier, `plan.pricePoints[${index}]`);
    const name = requireString(tier.tier, `plan.pricePoints[${index}].tier`);
    if (tierMap.has(name)) {
      throw new Error(`plan.pricePoints has duplicate tier "${name}"`);
    }
    const basePrice = requireNonNegativeNumber(tier.basePrice, `plan.pricePoints[${index}].basePrice`);
    const includedUnits = requireNonNegativeNumber(tier.includedUnits, `plan.pricePoints[${index}].includedUnits`);
    const overageRatePerUnit =
      tier.overageRatePerUnit === undefined || tier.overageRatePerUnit === null
        ? null
        : requireNonNegativeNumber(tier.overageRatePerUnit, `plan.pricePoints[${index}].overageRatePerUnit`);
    tierMap.set(name, { tier: name, basePrice, includedUnits, overageRatePerUnit });
  }

  const guardrails = requireObject(plan.guardrails, 'plan.guardrails');
  const resolvedGuardrails = {};
  for (const key of GUARDRAIL_KEYS) {
    resolvedGuardrails[key] = requireBoolean(guardrails[key], `plan.guardrails.${key}`);
  }
  const missingGuardrails = GUARDRAIL_KEYS.filter((key) => !resolvedGuardrails[key]);
  const usageExposed = model !== 'per-seat';

  const personas = requireArray(plan.personas, 'plan.personas', { minLength: 1 });

  const findings = [];
  const recommendations = [];
  const marginByPersona = {};
  let riskPoints = 0;

  if (!valueMetric.buyerCanPredict) {
    riskPoints += 2;
    findings.push(
      `Value metric "${valueMetric.name}" (${valueMetric.unit}) is not buyer-predictable — buyers cannot forecast a bill before the agent runs.`,
    );
    recommendations.push(
      `Replace "${valueMetric.name}" with a value metric the buyer directly controls (seats, completed tasks, resolved tickets, merged PRs) instead of a raw infra metric.`,
    );
  }

  if (usageExposed) {
    for (const key of missingGuardrails) {
      riskPoints += key === 'spendCap' || key === 'budgetPreview' ? 2 : 1;
      findings.push(`Missing guardrail "${key}" on a ${model} plan — usage-sensitive pricing without it risks bill shock.`);
    }
    if (missingGuardrails.includes('spendCap')) {
      recommendations.push('Add a hard spend cap enforced before task execution (see the cost-optimizer skill for runtime enforcement).');
    }
    if (missingGuardrails.includes('budgetPreview')) {
      recommendations.push('Show a per-task cost estimate before the agent runs, before the buyer commits to the run.');
    }
    if (missingGuardrails.includes('perTaskEstimate')) {
      recommendations.push('Emit a per-task cost estimate at submission time, not only in the monthly rollup.');
    }
    if (missingGuardrails.includes('transparentMetering')) {
      recommendations.push('Emit a line-item receipt per task (model calls, tokens, tool calls, $ cost) so usage is auditable after the fact.');
    }
  }

  for (const [index, persona] of personas.entries()) {
    requireObject(persona, `plan.personas[${index}]`);
    const name = requireString(persona.name, `plan.personas[${index}].name`);
    const tierName = requireString(persona.tier, `plan.personas[${index}].tier`);
    const monthlyUnits = requireNonNegativeNumber(persona.monthlyUnits, `plan.personas[${index}].monthlyUnits`);
    const tier = tierMap.get(tierName);
    if (!tier) {
      throw new Error(`plan.personas[${index}] references unknown tier "${tierName}"`);
    }

    const overageUnits = Math.max(0, monthlyUnits - tier.includedUnits);
    const unboundedOverage = overageUnits > 0 && tier.overageRatePerUnit === null;
    const overageRevenue = unboundedOverage ? 0 : overageUnits * (tier.overageRatePerUnit || 0);
    const revenue = tier.basePrice + overageRevenue;
    const cost = totalUnitCost * monthlyUnits;
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? margin / revenue : cost > 0 ? -1 : 0;

    let status;
    if (margin < 0) {
      status = 'negative';
    } else if (marginPct < targetMarginPct) {
      status = 'thin';
    } else {
      status = 'healthy';
    }

    marginByPersona[name] = {
      tier: tierName,
      monthlyUnits,
      overageUnits: round2(overageUnits),
      revenue: round2(revenue),
      cost: round2(cost),
      margin: round2(margin),
      marginPct: Math.round(marginPct * 1000) / 10,
      status,
    };

    if (status === 'negative') {
      riskPoints += 3;
      findings.push(
        `${name}: NEGATIVE margin ($${round2(margin)}) on tier "${tierName}" at ${monthlyUnits} ${valueMetric.unit}/mo — cost ($${round2(
          cost,
        )}) exceeds revenue ($${round2(revenue)}).`,
      );
      recommendations.push(
        `Raise the price floor or add per-unit overage billing on tier "${tierName}" — ${name} costs more than it pays.`,
      );
    } else if (status === 'thin') {
      riskPoints += 1;
      findings.push(
        `${name}: thin margin (${marginByPersona[name].marginPct}%) on tier "${tierName}", below the ${round2(
          targetMarginPct * 100,
        )}% target.`,
      );
    }

    if (unboundedOverage) {
      riskPoints += 1;
      findings.push(
        `${name}: exceeds the included ${tier.includedUnits} ${valueMetric.unit} on tier "${tierName}" with no overage rate defined — unbounded margin erosion for heavy usage.`,
      );
      recommendations.push(
        `Define an overageRatePerUnit for tier "${tierName}" so heavy users like ${name} do not run free above the included allotment.`,
      );
    } else if (overageUnits > 0 && usageExposed && (missingGuardrails.includes('spendCap') || missingGuardrails.includes('budgetPreview'))) {
      riskPoints += 1;
      findings.push(
        `${name}: bills $${round2(overageRevenue)} in unguarded overage on tier "${tierName}" — no spend cap or budget preview would have warned them first.`,
      );
    }
  }

  let level;
  if (riskPoints === 0) {
    level = 'none';
  } else if (riskPoints <= 2) {
    level = 'low';
  } else if (riskPoints <= 4) {
    level = 'medium';
  } else {
    level = 'high';
  }

  const negativeMarginPersonas = Object.entries(marginByPersona).filter(([, v]) => v.status === 'negative');
  const pass = negativeMarginPersonas.length === 0 && level !== 'high' && valueMetric.buyerCanPredict === true;

  if (recommendations.length === 0) {
    recommendations.push('Plan clears the cost floor and guardrail bar for the modeled personas — recheck when unit costs or personas change.');
  }

  return {
    pass,
    model,
    valueMetric: { name: valueMetric.name, unit: valueMetric.unit, buyerCanPredict: valueMetric.buyerCanPredict },
    unitCostFloor: {
      modelTokenCost,
      toolCompute,
      overhead,
      totalUnitCost: round2(totalUnitCost),
    },
    marginByPersona,
    billShockRisk: {
      level,
      riskPoints,
      missingGuardrails: usageExposed ? missingGuardrails : [],
    },
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: pricing_stress.mjs --input <file>.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(stressPricingPlan(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`pricing_stress: ${error.message}\n`);
    process.exit(1);
  }
}
