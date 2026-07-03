#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE_STAKES_AXES = ['singleAgentLoop', 'latency', 'contextAttach', 'recoverableEdits'];
const RATING_RANK = { 'below-par': 0, par: 1, 'above-par': 2 };
const DIFFERENTIATOR_AXES = ['isolationClaims', 'swarmVisibility', 'transcriptsSalvage', 'receipts', 'spendVisibility'];
const VALID_TRIGGERS = new Set([
  'fixed-while-watching',
  'queued-next-task',
  'reverted-cleanly',
  'swarm-no-collision',
  'faster-than-incumbent-loop',
  'trusted-receipt-no-rereview',
]);
const DEFAULT_DIFFERENTIATOR_THRESHOLD = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a multi-agent authoring product's self-assessment against the
 * dogfood product-quality bar: it must MATCH incumbents (Claude Code, Codex)
 * on table-stakes single-agent-loop quality, then EXCEED them on the
 * coordination/visibility/recovery differentiators they don't expose, and
 * the whole claim must rest on an honest, non-vanity stickiness signal.
 *
 * Table-stakes parity is a hard gate: a below-par axis cannot be offset by
 * strong differentiators. Differentiators are only counted "real" when they
 * are present, have actual behavior behind them, and leave a receipt —
 * anything else is Potemkin and is flagged, not credited.
 *
 * @param {unknown} product - parsed JSON self-assessment.
 * @returns {{pass: boolean, tableStakesScore: number, tableStakesMax: number, tableStakesParity: boolean, tableStakesBreakdown: Record<string,string>, differentiatorScore: number, differentiatorThreshold: number, differentiatorsMeetThreshold: boolean, differentiatorBreakdown: Record<string,object>, honestStickiness: boolean, recognizedTriggerCount: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditDogfoodBar(product) {
  if (!isPlainObject(product)) {
    throw new Error('product must be a JSON object');
  }
  if (!isPlainObject(product.tableStakes)) {
    throw new Error('product.tableStakes must be an object with singleAgentLoop, latency, contextAttach, recoverableEdits');
  }
  if (!isPlainObject(product.differentiators)) {
    throw new Error('product.differentiators must be an object with isolationClaims, swarmVisibility, transcriptsSalvage, receipts, spendVisibility');
  }
  if (!isPlainObject(product.stickiness)) {
    throw new Error('product.stickiness must be an object with comebackTriggers and usesOverIncumbentForRealWork');
  }
  if (typeof product.metricsHonest !== 'boolean') {
    throw new Error('product.metricsHonest must be a boolean');
  }

  const findings = [];
  const recommendations = [];

  // --- Table stakes: MATCH the incumbent. Any gap gates the whole audit. ---
  const tableStakesBreakdown = {};
  let tableStakesScore = 0;
  let tableStakesParity = true;
  for (const axis of TABLE_STAKES_AXES) {
    const rating = product.tableStakes[axis];
    if (!Object.prototype.hasOwnProperty.call(RATING_RANK, rating)) {
      throw new Error(`product.tableStakes.${axis} must be one of below-par|par|above-par`);
    }
    tableStakesBreakdown[axis] = rating;
    tableStakesScore += RATING_RANK[rating];
    if (RATING_RANK[rating] < RATING_RANK.par) {
      tableStakesParity = false;
      findings.push({
        id: `table-stakes-gap-${axis}`,
        severity: 'critical',
        message: `${axis} is below-par against the incumbent single-agent loop (Claude Code/Codex); differentiators cannot compensate for this.`,
      });
      recommendations.push(`Bring ${axis} to parity with the incumbent before investing further in multi-agent differentiation.`);
    }
  }
  const tableStakesMax = TABLE_STAKES_AXES.length * 2;

  // --- Differentiators: EXCEED on the axes incumbents don't expose. ---
  const threshold = Number.isInteger(product.differentiatorThreshold)
    ? product.differentiatorThreshold
    : DEFAULT_DIFFERENTIATOR_THRESHOLD;
  const differentiatorBreakdown = {};
  let differentiatorScore = 0;
  for (const axis of DIFFERENTIATOR_AXES) {
    const d = product.differentiators[axis];
    if (!isPlainObject(d)) {
      throw new Error(`product.differentiators.${axis} must be an object with present, hasRealBehavior, leavesReceipt`);
    }
    for (const key of ['present', 'hasRealBehavior', 'leavesReceipt']) {
      if (typeof d[key] !== 'boolean') {
        throw new Error(`product.differentiators.${axis}.${key} must be a boolean`);
      }
    }
    const real = d.present && d.hasRealBehavior && d.leavesReceipt;
    const potemkin = d.present && !real;
    differentiatorBreakdown[axis] = { present: d.present, hasRealBehavior: d.hasRealBehavior, leavesReceipt: d.leavesReceipt, real, potemkin };
    if (real) {
      differentiatorScore += 1;
    } else if (potemkin) {
      const reason = !d.hasRealBehavior ? 'has no real behavior behind it' : 'leaves no receipt';
      findings.push({
        id: `potemkin-differentiator-${axis}`,
        severity: 'high',
        message: `${axis} is present but ${reason} — it looks like the differentiator without being one.`,
      });
      recommendations.push(`Either wire real behavior and a receipt into ${axis}, or stop counting it as a reason to switch.`);
    } else {
      recommendations.push(`${axis} is not built yet; fine to defer, but it cannot count toward the differentiator threshold until it is.`);
    }
  }
  const differentiatorsMeetThreshold = differentiatorScore >= threshold;
  if (!differentiatorsMeetThreshold) {
    findings.push({
      id: 'insufficient-real-differentiators',
      severity: 'critical',
      message: `Only ${differentiatorScore} of ${DIFFERENTIATOR_AXES.length} differentiators are real (present, working, receipted); threshold is ${threshold}.`,
    });
    recommendations.push('Ship fewer, real differentiators rather than more Potemkin ones — pick the highest-leverage axes and make them genuinely work end-to-end.');
  }

  // --- Stickiness: honest comeback signal, not vanity counts. ---
  const triggers = Array.isArray(product.stickiness.comebackTriggers) ? product.stickiness.comebackTriggers : null;
  if (triggers === null) {
    throw new Error('product.stickiness.comebackTriggers must be an array');
  }
  if (typeof product.stickiness.usesOverIncumbentForRealWork !== 'boolean') {
    throw new Error('product.stickiness.usesOverIncumbentForRealWork must be a boolean');
  }
  const unknownTriggers = triggers.filter((t) => !VALID_TRIGGERS.has(t));
  if (unknownTriggers.length > 0) {
    findings.push({
      id: 'unrecognized-comeback-trigger',
      severity: 'medium',
      message: `Unrecognized comeback trigger(s): ${unknownTriggers.join(', ')}. Use the documented vocabulary in references/dogfood-stickiness-signals.md rather than vague self-praise.`,
    });
  }
  const recognizedTriggerCount = triggers.length - unknownTriggers.length;

  let honestStickiness = true;
  if (!product.stickiness.usesOverIncumbentForRealWork) {
    honestStickiness = false;
    findings.push({
      id: 'no-real-dogfood-signal',
      severity: 'critical',
      message: 'No signal that the makers actually use this over Claude Code/Codex for real work — the dogfood thesis is unproven.',
    });
    recommendations.push('Before shipping more surface area, get at least one maker reaching for this tool over the incumbent for a real task, and record why.');
  }
  if (recognizedTriggerCount === 0) {
    honestStickiness = false;
    findings.push({
      id: 'no-comeback-triggers',
      severity: 'high',
      message: 'No recognized comeback triggers recorded; stickiness is asserted, not evidenced.',
    });
    recommendations.push('Capture at least one concrete comeback trigger from the documented vocabulary, sourced from an actual session, not an aspiration.');
  }
  if (!product.metricsHonest) {
    honestStickiness = false;
    findings.push({
      id: 'vanity-metrics-admitted',
      severity: 'high',
      message: 'metricsHonest is false: the team is reporting vanity counts (agents launched, demos run) as the primary success signal instead of real-work usage.',
    });
    recommendations.push('Replace agents-launched/demos-run counts with the comeback-trigger vocabulary plus a direct usesOverIncumbentForRealWork check.');
  }

  const pass = tableStakesParity && differentiatorsMeetThreshold && honestStickiness;
  if (pass) {
    recommendations.push('Bar cleared: table-stakes parity holds, enough differentiators are real, and the dogfood signal is honest. Recheck after any table-stakes regression or new differentiator claim.');
  }

  return {
    pass,
    tableStakesScore,
    tableStakesMax,
    tableStakesParity,
    tableStakesBreakdown,
    differentiatorScore,
    differentiatorThreshold: threshold,
    differentiatorsMeetThreshold,
    differentiatorBreakdown,
    honestStickiness,
    recognizedTriggerCount,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: dogfood_bar.mjs --input <product-self-assessment>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditDogfoodBar(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`dogfood_bar: ${error.message}\n`);
    process.exit(1);
  }
}
