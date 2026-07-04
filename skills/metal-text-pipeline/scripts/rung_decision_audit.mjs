#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_RUNGS = [1, 2, 3];
const VALID_SURFACE_KINDS = ['2d-vector-text', '3d', 'static-svg'];
const VALID_GLYPH_SOURCES = ['parley', 'bitmap-font', 'hand-atlas'];
const SEVERITY_DEDUCTION = { critical: 40, high: 20, medium: 10, low: 5 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audit a rung-decision plan against this skill's core thesis: default to
 * Rung 1 (Vello + Parley on wgpu); drop a rung only against a NAMED,
 * MEASURED constraint. Encodes the skill's Failure Modes and Anti-Patterns
 * as deterministic checks over structured fields — no keyword/text matching.
 *
 * @param {unknown} plan - parsed JSON rung-decision plan (see
 *   schemas/rung-plan.schema.json).
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditRungDecision(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('rung decision plan must be a JSON object');
  }

  const { chosenRung, surfaceKind, glyphSource } = plan;
  if (!VALID_RUNGS.includes(chosenRung)) {
    throw new Error(`plan.chosenRung must be one of ${VALID_RUNGS.join(', ')}`);
  }
  if (!VALID_SURFACE_KINDS.includes(surfaceKind)) {
    throw new Error(`plan.surfaceKind must be one of ${VALID_SURFACE_KINDS.join(', ')}`);
  }
  if (!VALID_GLYPH_SOURCES.includes(glyphSource)) {
    throw new Error(`plan.glyphSource must be one of ${VALID_GLYPH_SOURCES.join(', ')}`);
  }

  const rawConstraint = plan.namedConstraintForLowerRung ?? null;
  if (rawConstraint !== null && !isNonEmptyString(rawConstraint)) {
    throw new Error('plan.namedConstraintForLowerRung must be a non-empty string or null');
  }

  const hasNamedConstraint = isNonEmptyString(rawConstraint);
  const measuredRung1Miss = plan.measuredRung1Miss === true;
  const promotionFrameRateRequested = plan.promotionFrameRateRequested === true;
  const redrawEveryFrame = plan.redrawEveryFrame === true;
  const tripleBuffered = plan.tripleBuffered === true;
  const keptOutOfLinuxCI = plan.keptOutOfLinuxCI === true;

  const findings = [];
  const recommendations = [];
  let score = 100;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    score -= SEVERITY_DEDUCTION[severity] ?? 5;
  }

  // --- Failure Mode 1: "let's go pure Metal for speed" with no measurement ---
  if (chosenRung === 3) {
    if (!hasNamedConstraint && !measuredRung1Miss) {
      fail(
        'unjustified-rung3-drop',
        'critical',
        'chosenRung=3 with no namedConstraintForLowerRung and no measuredRung1Miss: this is "let\'s go pure Metal for speed" with nothing behind it.',
        'Build the Rung-1 (Vello+Parley) version first, measure it against a real budget, and only drop to Rung 3 against a named Metal feature or a measured miss.'
      );
    } else if (!hasNamedConstraint) {
      fail(
        'rung3-no-named-constraint',
        'high',
        'chosenRung=3 has measuredRung1Miss=true but no namedConstraintForLowerRung explaining WHY Rung 3 fixes it.',
        'Name the specific Metal feature or budget Rung 1 cannot meet (e.g. tile shaders/imageblocks, a shared MTLCommandQueue, a sub-100µs frame budget).'
      );
    } else if (!measuredRung1Miss) {
      fail(
        'rung3-no-measurement',
        'high',
        'chosenRung=3 names a constraint but measuredRung1Miss=false: the Rung-1 baseline was never actually measured against it.',
        'Measure Rung 1 (Vello+Parley) against the named constraint before committing to Rung 3; "it will probably be too slow" is not a measurement.'
      );
    }
  }

  // --- Failure Mode 2: reinventing the vector rasterizer ---
  if (chosenRung === 3 && surfaceKind === '2d-vector-text') {
    fail(
      'reinventing-vector-rasterizer',
      hasNamedConstraint && measuredRung1Miss ? 'medium' : 'critical',
      "chosenRung=3 for a 2d-vector-text surface means hand-writing anti-aliased bezier fill/stroke in MSL — exactly what Vello's compute pipeline already is.",
      'Confirm the named constraint is a Metal feature Vello genuinely cannot expose, not just "it would be faster" — this is the single biggest cost of Rung 3.'
    );
  }

  // --- Failure Mode 3: ProMotion locked to 60 ---
  if (!redrawEveryFrame) {
    fail(
      'no-redraw-every-frame',
      'high',
      'redrawEveryFrame=false: the app only redraws on input, which caps the perceived frame rate regardless of rung or display capability.',
      'Request the next frame unconditionally while animating; the renderer is rarely the bottleneck, the event loop usually is.'
    );
  }
  if (chosenRung === 3 && !promotionFrameRateRequested) {
    fail(
      'promotion-rate-not-requested',
      'high',
      'chosenRung=3 (CAMetalLayer) with promotionFrameRateRequested=false: without requesting the 120Hz cadence via preferredFrameRateRange, ProMotion displays render at 60.',
      'Set CADisplayLink.preferredFrameRateRange (and CAMetalLayer.displaySyncEnabled=true) to request the display\'s native cadence.'
    );
  }

  // --- Anti-Pattern: fixed bitmap font ---
  if (glyphSource === 'bitmap-font') {
    fail(
      'fixed-bitmap-font',
      'critical',
      'glyphSource=bitmap-font: a fixed bitmap font throws away shaping, hinting, variable fonts, RTL/complex scripts, and HiDPI crispness.',
      'Use Parley (Rung 1) for shaping+layout, or at minimum a real shaper (HarfBuzz/HarfRust/CoreText) feeding a glyph atlas — never a fixed bitmap font.'
    );
  }

  // --- Anti-Pattern: single-buffering a hand-rolled Metal frame ---
  if (chosenRung === 3 && !tripleBuffered) {
    fail(
      'single-buffered-rung3',
      'critical',
      'chosenRung=3 with tripleBuffered=false: a single per-frame buffer the GPU may still be reading causes tearing/races or a full stall.',
      "Triple-buffer per-frame uniform/vertex buffers and gate frame N+3 on a dispatch_semaphore signaled in the command buffer's completion handler."
    );
  }

  // --- wgpu/objc2 must stay out of Linux CI ---
  if (!keptOutOfLinuxCI) {
    fail(
      'not-kept-out-of-linux-ci',
      'medium',
      'keptOutOfLinuxCI=false: this pipeline (wgpu Metal backend selection, or objc2/objc2-metal at Rung 3) is Apple-GPU-specific and will fail or silently no-op in Linux CI.',
      'Gate this crate/module behind a macOS-only cfg or feature flag and keep it out of the default Linux CI test matrix.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = clampedScore >= 70 && !findings.some((f) => f.severity === 'critical');

  if (findings.length === 0) {
    recommendations.push('Plan is consistent with the Rung-1-by-default thesis. Spot-check that the named constraint and measurement (if any) are real, not just present in the plan.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: rung_decision_audit.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditRungDecision(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`rung_decision_audit: ${error.message}\n`);
    process.exit(1);
  }
}
