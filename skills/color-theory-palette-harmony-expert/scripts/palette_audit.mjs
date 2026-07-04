#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Audit a palette-selection plan against this skill's own detection rules
 * (see SKILL.md Failure Modes and Quality Gates).
 *
 * This is a deterministic, structural check over numeric/enum fields only —
 * it cannot tell you whether a palette actually looks good, only whether the
 * plan's own reported diagnostics trip one of the five documented failure
 * modes: Perceptual Mismatch (wrong color space), Diversity Collapse,
 * Saturation Monotony, Temperature Incoherence, and EMD Optimization
 * Failure (Sinkhorn non-convergence) — plus the authenticity-loss gate on
 * color-grading blend ratio.
 *
 * @param {unknown} plan - parsed JSON palette-selection plan.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPaletteSelection(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let criticalOrHighHit = false;

  function flag(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical' || severity === 'high') criticalOrHighHit = true;
  }

  // --- Perceptual Mismatch: not working in LAB ---
  const colorSpace = plan.colorSpace;
  if (colorSpace !== 'lab') {
    flag(
      'perceptual-mismatch',
      'critical',
      `colorSpace is '${colorSpace ?? 'undefined'}', not 'lab'. RGB/HSV distance is not perceptually uniform and produces palettes that are mathematically similar but look wrong to humans.`,
      "Convert to LAB space before computing any color distance, and use deltaEMethod 'ciede2000' or 'de94'."
    );
  } else if (plan.deltaEMethod === 'euclidean') {
    recommendations.push(
      "colorSpace is 'lab' but deltaEMethod is 'euclidean' — a fast approximation. Prefer 'ciede2000' when perceptual accuracy matters more than speed."
    );
  }

  // --- Diversity Collapse: maxPairwiseEmd too low or lambda too high ---
  const selection = isPlainObject(plan.selection) ? plan.selection : {};
  const lambda = selection.lambda;
  const maxPairwiseEmd = plan.maxPairwiseEmd;
  const lambdaTooHigh = isFiniteNumber(lambda) && lambda > 0.8;
  const emdTooLow = isFiniteNumber(maxPairwiseEmd) && maxPairwiseEmd < 0.3;
  if (lambdaTooHigh || emdTooLow) {
    const reasons = [];
    if (emdTooLow) reasons.push(`maxPairwiseEmd=${maxPairwiseEmd} < 0.3`);
    if (lambdaTooHigh) reasons.push(`selection.lambda=${lambda} > 0.8`);
    flag(
      'diversity-collapse',
      'high',
      `Diversity Collapse risk ("all blue skies"): ${reasons.join(' and ')}.`,
      'Reduce selection.lambda to 0.5-0.7, or switch selection.algo from a pure-harmony match to mmr/dpp.'
    );
  }

  // --- Saturation Monotony ---
  const chromaStdDev = plan.chromaStdDev;
  if (isFiniteNumber(chromaStdDev) && chromaStdDev < 15) {
    flag(
      'saturation-monotony',
      'medium',
      `chromaStdDev=${chromaStdDev} < 15: selected palettes have near-identical chroma levels, lacking visual interest.`,
      'Add a chroma-variance bonus term to the selection objective function.'
    );
  }

  // --- Temperature Incoherence ---
  const maxAdjacentTempDeltaB = plan.maxAdjacentTempDeltaB;
  if (isFiniteNumber(maxAdjacentTempDeltaB) && Math.abs(maxAdjacentTempDeltaB) > 40) {
    flag(
      'temperature-incoherence',
      'high',
      `maxAdjacentTempDeltaB=${maxAdjacentTempDeltaB} exceeds 40 LAB b-units: adjacent selections have jarring warm/cool transitions.`,
      'Implement a temperature-wave arrangement or enforce a minimum transition buffer zone between adjacent selections.'
    );
  }

  // --- EMD Optimization Failure: Sinkhorn non-convergence ---
  const sinkhorn = isPlainObject(plan.sinkhorn) ? plan.sinkhorn : {};
  const iterations = sinkhorn.iterations;
  const relError = sinkhorn.relError;
  const iterationsTooHigh = isFiniteNumber(iterations) && iterations > 50;
  const relErrorTooHigh = isFiniteNumber(relError) && relError > 0.01;
  if (iterationsTooHigh || relErrorTooHigh) {
    const reasons = [];
    if (iterationsTooHigh) reasons.push(`sinkhorn.iterations=${iterations} > 50`);
    if (relErrorTooHigh) reasons.push(`sinkhorn.relError=${relError} > 0.01`);
    flag(
      'sinkhorn-non-convergence',
      'high',
      `EMD Optimization Failure: ${reasons.join(' and ')}.`,
      'Increase the Sinkhorn epsilon parameter (e.g. to 0.1), add regularization to the cost matrix, or fall back to exact EMD.'
    );
  }

  // --- Authenticity loss: blend ratio too aggressive ---
  const blendRatio = plan.blendRatio;
  if (isFiniteNumber(blendRatio) && blendRatio > 0.4) {
    flag(
      'authenticity-loss',
      'medium',
      `blendRatio=${blendRatio} exceeds 0.4: color grading this aggressive loses photo authenticity.`,
      'Cap blendRatio at 0.4 or apply grading only to the most extreme outliers rather than the whole set.'
    );
  }

  // --- Missing/malformed required numeric fields (structural, not a color-science failure mode) ---
  const requiredNumeric = {
    maxPairwiseEmd,
    chromaStdDev,
    hueCoverageDegrees: plan.hueCoverageDegrees,
    maxAdjacentTempDeltaB,
    blendRatio,
  };
  const missingNumeric = Object.entries(requiredNumeric)
    .filter(([, value]) => !isFiniteNumber(value))
    .map(([key]) => key);
  if (missingNumeric.length > 0) {
    flag(
      'incomplete-plan',
      'high',
      `Plan is missing or has non-numeric values for: ${missingNumeric.join(', ')}.`,
      'Measure and record every diagnostic field before treating the plan as auditable.'
    );
  }

  if (findings.length === 0) {
    recommendations.push(
      'Plan passes all documented failure-mode checks. Spot-check a rendered preview against the target palette before trusting the score.'
    );
  }

  return {
    pass: !criticalOrHighHit,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: palette_audit.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditPaletteSelection(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`palette_audit: ${error.message}\n`);
    process.exit(1);
  }
}
